"""Where the follower / leader photos of a following event live on disk.

Files are named by convention (no extra DB columns):
``snapshots/job_<job>_<event key>_<role>_<kind>.jpg`` with role = follower | leader and
kind = face | person.
"""
from __future__ import annotations

from pathlib import Path

import cv2

from ..config import app_config

ROLES = ("follower", "leader")
KINDS = ("face", "person")


def photo_path(job_id: int, event_key: str, role: str, kind: str) -> Path:
    return app_config.snapshot_dir / f"job_{job_id}_{event_key}_{role}_{kind}.jpg"


def save_photo(job_id: int, event_key: str, role: str, photo) -> None:
    """``photo`` is a :class:`app.core.photos.Photo`."""
    cv2.imwrite(str(photo_path(job_id, event_key, role, "person")), photo.person, [cv2.IMWRITE_JPEG_QUALITY, 90])
    cv2.imwrite(str(photo_path(job_id, event_key, role, "face")), photo.face, [cv2.IMWRITE_JPEG_QUALITY, 92])


def photo_flags(job_id: int, event_key: str) -> dict:
    return {role: photo_path(job_id, event_key, role, "person").exists() for role in ROLES}


def job_snapshot_files(job_id: int) -> list[Path]:
    """Every snapshot / photo file that belongs to a job (for clean-up on delete)."""
    return list(app_config.snapshot_dir.glob(f"job_{job_id}_*.jpg"))
