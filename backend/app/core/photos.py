"""Best-photo capture for tracked pedestrians.

For every track the bank keeps the clearest picture seen so far: a full-body crop and a
face / head crop, both cut from the *clean* frame (before boxes are drawn). When a
following event is raised the pipeline attaches the photos of the follower and of the
leader so the dashboard can show who is following whom.

A frontal-face detector (OpenCV Haar cascade, bundled with OpenCV) is run on the head
region; when it finds a face the crop is centred on it and the picture is preferred over
back views. On typical CCTV footage faces are often too small or turned away - then the
head region of the person box is used instead. No identification is performed.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

PERSON_MAX_H = 420  # stored body crops are at most this tall
FACE_SIZE = 200  # stored face crops are FACE_SIZE x FACE_SIZE
EVAL_INTERVAL = 0.3  # seconds between quality evaluations of the same track
FORGET_AFTER = 30.0  # drop photos of tracks not seen for this long


@dataclass
class Photo:
    person: np.ndarray  # BGR full-body crop
    face: np.ndarray  # BGR face / head crop (square)
    face_found: bool  # True when a frontal face was detected
    score: float
    t: float  # video time of the picture


class PhotoBank:
    def __init__(self) -> None:
        self.best: dict[int, Photo] = {}
        self._last_eval: dict[int, float] = {}
        self._last_seen: dict[int, float] = {}
        try:
            self._cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            if self._cascade.empty():
                self._cascade = None
        except Exception:  # noqa: BLE001  (OpenCV build without the cascade files)
            self._cascade = None

    # ------------------------------------------------------------------ public
    def update(self, frame: np.ndarray, detections, t: float) -> None:
        """detections: [(track_id, (x1, y1, x2, y2), conf)] on the un-annotated ``frame``."""
        H, W = frame.shape[:2]
        for tid, (x1, y1, x2, y2), conf in detections:
            self._last_seen[tid] = t
            if t - self._last_eval.get(tid, -1e9) < EVAL_INTERVAL:
                continue
            h, w = y2 - y1, x2 - x1
            if h < 24 or w < 8:
                continue
            cut = x1 <= 2 or y1 <= 2 or x2 >= W - 2 or y2 >= H - 2
            base = h * (0.5 + conf) * (0.35 if cut else 1.0)
            best = self.best.get(tid)
            # a detected face is worth 1.8x: skip the (costlier) face search when it cannot win
            if best is not None and base * 1.8 <= best.score:
                continue
            self._last_eval[tid] = t
            face_box = self._find_face(frame, x1, y1, x2, y2)
            score = base * (1.8 if face_box else 1.0)
            if best is not None and score <= best.score:
                continue
            self.best[tid] = Photo(person=self._person_crop(frame, x1, y1, x2, y2),
                                   face=self._face_crop(frame, face_box or self._head_box(x1, y1, x2, y2)),
                                   face_found=bool(face_box), score=score, t=t)
        if len(self._last_seen) > 400:
            for tid in [k for k, seen in self._last_seen.items() if t - seen > FORGET_AFTER]:
                self._last_seen.pop(tid, None)
                self._last_eval.pop(tid, None)
                self.best.pop(tid, None)

    def get(self, tid: int) -> Photo | None:
        return self.best.get(tid)

    # --------------------------------------------------------------- internals
    @staticmethod
    def _head_box(x1, y1, x2, y2) -> tuple[float, float, float, float]:
        h = y2 - y1
        side = max(0.30 * h, 12.0)
        cx = (x1 + x2) / 2
        top = y1 - 0.04 * h
        return cx - side / 2, top, cx + side / 2, top + side

    def _find_face(self, frame, x1, y1, x2, y2):
        if self._cascade is None:
            return None
        H, W = frame.shape[:2]
        h = y2 - y1
        rx1, ry1 = int(max(0, x1 - 0.05 * h)), int(max(0, y1 - 0.05 * h))
        rx2, ry2 = int(min(W, x2 + 0.05 * h)), int(min(H, y1 + 0.38 * h))
        if rx2 - rx1 < 12 or ry2 - ry1 < 12:
            return None
        roi = cv2.cvtColor(frame[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2GRAY)
        k = min(4.0, max(1.0, 110.0 / roi.shape[0]))  # small heads are enlarged before the search
        if k > 1.05:
            roi = cv2.resize(roi, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        roi = cv2.equalizeHist(roi)
        faces = self._cascade.detectMultiScale(roi, scaleFactor=1.12, minNeighbors=5, minSize=(22, 22))
        if len(faces) == 0:
            return None
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        cx, cy, side = rx1 + (fx + fw / 2) / k, ry1 + (fy + fh / 2) / k, max(fw, fh) / k * 1.7
        return cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2

    @staticmethod
    def _crop(frame, box) -> np.ndarray:
        H, W = frame.shape[:2]
        x1, y1, x2, y2 = (int(round(v)) for v in box)
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
        if x2 - x1 < 2 or y2 - y1 < 2:
            return np.zeros((2, 2, 3), np.uint8)
        return frame[y1:y2, x1:x2].copy()

    def _person_crop(self, frame, x1, y1, x2, y2) -> np.ndarray:
        h, w = y2 - y1, x2 - x1
        crop = self._crop(frame, (x1 - 0.12 * w, y1 - 0.05 * h, x2 + 0.12 * w, y2 + 0.04 * h))
        if crop.shape[0] > PERSON_MAX_H:
            k = PERSON_MAX_H / crop.shape[0]
            crop = cv2.resize(crop, (max(2, int(crop.shape[1] * k)), PERSON_MAX_H), interpolation=cv2.INTER_AREA)
        return crop

    def _face_crop(self, frame, box) -> np.ndarray:
        crop = self._crop(frame, box)
        interp = cv2.INTER_CUBIC if crop.shape[0] < FACE_SIZE else cv2.INTER_AREA
        return cv2.resize(crop, (FACE_SIZE, FACE_SIZE), interpolation=interp)
