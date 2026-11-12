"""Draws boxes, IDs, trajectories, following links, groups and crowd zones on frames."""
from __future__ import annotations

import colorsys

import cv2
import numpy as np

RED = (60, 60, 235)
ORANGE = (0, 150, 255)
GREEN = (90, 200, 60)
YELLOW = (0, 215, 255)
PURPLE = (200, 60, 190)  # follows somebody *and* is followed by somebody else
WHITE = (255, 255, 255)
DARK = (25, 25, 25)
LEVEL_COLORS = {"normal": GREEN, "elevated": YELLOW, "critical": RED}


def id_color(tid: int) -> tuple[int, int, int]:
    h = (tid * 0.61803398875) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.65, 0.95)
    return int(b * 255), int(g * 255), int(r * 255)


def _label(img, text, x, y, color, scale=0.45):
    """Filled label whose bottom-left corner is (x, y); ``text`` may be a list of lines
    (stacked upwards). The label is shifted to stay inside the frame."""
    lines = [text] if isinstance(text, str) else list(text)
    sizes = [cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)[0] for line in lines]
    tw, th = max(w for w, _ in sizes), max(h for _, h in sizes)
    row = th + 5
    x = int(min(max(0, x), max(0, img.shape[1] - tw - 4)))
    y = int(min(max(row * len(lines), y), img.shape[0]))
    cv2.rectangle(img, (x, y - row * len(lines)), (x + tw + 4, y), color, -1)
    for i, line in enumerate(lines):
        base = y - row * (len(lines) - 1 - i) - 3
        cv2.putText(img, line, (x + 2, base), cv2.FONT_HERSHEY_SIMPLEX, scale, DARK, 1, cv2.LINE_AA)


def follow_roles(follows) -> tuple[dict[int, list[int]], dict[int, list[int]], set[tuple[int, int]]]:
    """Many-to-many view of the active following links.

    Returns ``(leaders_of, followers_of, indirect)``: every person can follow several people
    and be followed by several people at once (e.g. a chain 3 -> 2 -> 1, where 2 is both).
    ``indirect`` holds the links that are implied by a chain (3 -> 1 when 3 -> 2 and 2 -> 1
    are active too); they are drawn thinner so the picture stays readable.
    """
    leaders_of: dict[int, list[int]] = {}
    followers_of: dict[int, list[int]] = {}
    for leader, follower, _ in follows:
        leaders_of.setdefault(follower, []).append(leader)
        followers_of.setdefault(leader, []).append(follower)
    indirect = {(leader, follower) for leader, follower, _ in follows
                if any(leader in leaders_of.get(mid, ()) for mid in leaders_of[follower] if mid != leader)}
    return leaders_of, followers_of, indirect


def _ids(ids: list[int], limit: int = 3) -> str:
    ids = sorted(ids)
    return ",".join(map(str, ids[:limit])) + ("+" if len(ids) > limit else "")


def draw_frame(img: np.ndarray, *, detections, trajectories, follows, groups, clusters,
               hud: dict) -> np.ndarray:
    """
    detections:   [(tid, (x1,y1,x2,y2), conf)]
    trajectories: {tid: Nx2 array in frame coordinates}
    follows:      [(leader_id, follower_id, confidence)]
    groups:       {group_key: [tid, ...]}
    clusters:     [Cluster] congestion zones (frame coordinates)
    """
    out = img
    scale = max(0.4, min(out.shape[:2]) / 900)
    overlay = out.copy()
    for c in clusters:
        x1, y1, x2, y2 = map(int, c.bbox)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), YELLOW, -1)
    if clusters:
        cv2.addWeighted(overlay, 0.18, out, 0.82, 0, out)
    for c in clusters:
        x1, y1, x2, y2 = map(int, c.bbox)
        cv2.rectangle(out, (x1, y1), (x2, y2), YELLOW, 2)
        _label(out, f"Congestion: {c.size} people", x1, y1 - 2, YELLOW, 0.5 * scale)

    for tid, pts in trajectories.items():
        if len(pts) >= 2:
            cv2.polylines(out, [pts.astype(np.int32).reshape(-1, 1, 2)], False, id_color(tid), 2, cv2.LINE_AA)

    by_id = {tid: box for tid, box, _ in detections}
    leaders_of, followers_of, indirect = follow_roles(follows)
    member_of = {m: g for g, ms in groups.items() for m in ms}

    for gkey, members in groups.items():
        feet = [((by_id[m][0] + by_id[m][2]) / 2, by_id[m][3]) for m in members if m in by_id]
        for i in range(len(feet) - 1):
            cv2.line(out, tuple(map(int, feet[i])), tuple(map(int, feet[i + 1])), GREEN, 2, cv2.LINE_AA)

    # arrows first, so the ID labels drawn afterwards stay readable
    for leader, follower, conf in follows:
        if leader in by_id and follower in by_id:
            lb, fb = by_id[leader], by_id[follower]
            p1 = (int((fb[0] + fb[2]) / 2), int((fb[1] + fb[3]) / 2))
            p2 = (int((lb[0] + lb[2]) / 2), int((lb[1] + lb[3]) / 2))
            if (leader, follower) in indirect:  # implied by a chain: keep it subtle
                cv2.arrowedLine(out, p1, p2, RED, 1, cv2.LINE_AA, tipLength=0.05)
                continue
            cv2.arrowedLine(out, p1, p2, RED, 3, cv2.LINE_AA, tipLength=0.08)
            mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
            _label(out, f"{conf:.0%}", mid[0], mid[1], RED, 0.5 * scale)

    # people involved in a following link are drawn last (on top) with a larger label
    involved = set(leaders_of) | set(followers_of)
    for tid, (x1, y1, x2, y2), conf in sorted(detections, key=lambda d: d[0] in involved):
        color, thick, text, size = id_color(tid), 2, f"ID {tid}", 0.42
        if tid in leaders_of and tid in followers_of:
            color, thick, size = PURPLE, 3, 0.52
            text = [f"ID {tid} FOLLOWS {_ids(leaders_of[tid])}", f"FOLLOWED BY {_ids(followers_of[tid])}"]
        elif tid in leaders_of:
            color, thick, text, size = RED, 3, f"ID {tid} FOLLOWS {_ids(leaders_of[tid])}", 0.52
        elif tid in followers_of:
            color, thick, text, size = ORANGE, 3, f"ID {tid} FOLLOWED BY {_ids(followers_of[tid])}", 0.52
        elif tid in member_of:
            color, text = GREEN, f"ID {tid} {member_of[tid]}"
        cv2.rectangle(out, (int(x1), int(y1)), (int(x2), int(y2)), color, thick)
        _label(out, text, x1, y1 - 2, color, size * scale)

    # HUD
    level = hud.get("level", "normal")
    lines = [
        f"t {hud.get('t', 0):6.1f}s",
        f"People {hud.get('count', 0)}",
        f"Crowd {level.upper()}",
        f"Following {len(follows)}",
        f"Groups {len(groups)}",
    ]
    fs = 0.55 * scale
    lh = int(26 * scale) + 4
    w = int(200 * scale) + 20
    cv2.rectangle(out, (8, 8), (8 + w, 8 + lh * len(lines) + 8), DARK, -1)
    for i, line in enumerate(lines):
        col = LEVEL_COLORS.get(level, WHITE) if line.startswith("Crowd") else (
            RED if line.startswith("Following") and follows else WHITE)
        cv2.putText(out, line, (16, 8 + lh * (i + 1)), cv2.FONT_HERSHEY_SIMPLEX, fs, col, 1, cv2.LINE_AA)
    return out
