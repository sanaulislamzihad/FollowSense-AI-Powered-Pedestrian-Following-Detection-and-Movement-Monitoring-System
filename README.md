# FollowSense AI

**AI-powered pedestrian following detection, group movement and crowd monitoring.**

FollowSense AI processes recorded video or live CCTV streams (RTSP / HTTP / webcam), detects and tracks
pedestrians, analyses their trajectories and flags situations where one person consistently appears to
follow another. It also detects group walking, measures crowd levels and congestion zones, and presents
everything in a real-time dashboard with review workflow and PDF/CSV reports.

> FollowSense reports *observable movement patterns*. It does not infer intent and does not identify people
> (anonymous track IDs, no face recognition). For every alert it stores a photo of the follower and of the
> followed person so a human operator can review it — every alert should be reviewed before acting.

---

## Screenshots

**Follow Watch** — who is following whom. Every detection is a card with the captured photo of the
follower and of the followed person, the confidence, duration and source. The two input options
(saved video / live CCTV) sit at the top of the page.

![Follow Watch dashboard](docs/screenshots/follow-watch.jpg)

**Face / person capture** — opening a detection shows the face / head crop and the full-body photo of
both people next to the annotated video, their trajectories and the movement evidence.

![Captured photos of the follower and the followed person](docs/screenshots/event-photos.jpg)

**Follow detection in a crowd** — annotated output. Red = follower, orange = followed, purple = both at
once (ID 2 follows IDs 4 and 7 while being followed by ID 15); everybody else keeps a plain track box.

![Following detection on a crowded plaza](docs/screenshots/follow-detection.jpg)

---

## Features

| Module | What it does |
|---|---|
| Pedestrian detection | Pretrained YOLO11 (COCO *person*), optional SAHI-style **tiled** mode for dense crowds |
| Multi-object tracking | ByteTrack or BoT-SORT (ultralytics implementations), configurable occlusion memory |
| Camera motion compensation | Background optical flow + RANSAC similarity → stabilised coordinates, so handheld / PTZ pans don't look like everybody walking together |
| Following detection | Custom trajectory engine: distance, direction, speed, relative position, **time-lagged path retracing**, temporal consistency |
| Relationship classes | Potential following · Same direction · Group walking · No following · Insufficient evidence |
| Group movement | Sustained side-by-side pairs → connected components with stable group IDs, join / leave / split history |
| Crowd management | People-in-view timeline, normal / elevated / critical levels, DBSCAN-style congestion zones, overcrowding & congestion alerts |
| Visualisation | Annotated H.264 video, live MJPEG view, trajectory map, density heatmap, direction rose, speed histogram |
| Person photos | For every following event the clearest face / head crop and full-body crop of the **follower** and the **followed** person are captured from the clean frame and kept up to date while the event is active |
| Follow Watch | Dashboard page showing *who follows whom* as photo cards (follower → followed), "happening now" vs detected, many-to-many notes ("also follows ID 4", "is followed by ID 9") |
| Two sources | **Saved video** (upload, analysed in the background) and **CCTV live** (RTSP / HTTP stream or webcam, analysed in real time) — both start from the Follow Watch page |
| Alerts & review | WebSocket toasts, event snapshots, confirm / dismiss / notes, jump to the moment in the video |
| Reports | Per-analysis PDF (ReportLab) and CSV export of following / crowd events |

## Architecture

```
 video file / RTSP ──► OpenCV capture ──► resize (≤1280 px) ──► YOLO11 person detection (+ tiles)
                                                                    │
                                    ByteTrack / BoT-SORT  ◄─────────┘
                                            │ track IDs + boxes
              camera motion compensation ◄──┤  (foot points → reference frame)
                                            ▼
                                       TrackStore (trajectory history, kinematics)
                     ┌──────────────────────┼───────────────────────────┐
              FollowingEngine          GroupTracker                CrowdMonitor
          (pairwise, every 0.25 s)   (components of group pairs)  (count, clusters, levels)
                     └──────────┬───────────┴───────────────────────────┘
                                ▼ EngineEvents
     JobManager (thread pool) ──► SQLAlchemy (PostgreSQL / SQLite) ──► FastAPI REST + WebSocket ──► React dashboard
                               └► annotated MP4, snapshots, heatmap, report.pdf
```

```
backend/
  app/core/        detector, tracks, motion, following, groups, crowd, annotate, pipeline
  app/services/    job manager, realtime hub, settings, rendering, reports
  app/api/         REST routers (videos, jobs, events, overview/cameras/settings)
  scripts/         analyze_video.py (CLI)
  tests/           engine, crowd/motion and API tests
frontend/          React 18 + Vite + Tailwind + Chart.js dashboard
Dockerfile, docker-compose.yml
```

## How following is detected

All distances are measured in **body heights** (the average bounding-box height of the two people). This
makes thresholds largely independent of resolution, zoom and camera angle.

Every 0.25 s each pair of nearby tracks is resampled on a common 5 Hz grid over the last
`analysis_window_sec` (default 4 s) and compared:

1. **Distance** — mean separation must be within `follow_min_distance … follow_max_distance` (0.7–6 bh).
2. **Direction similarity** — mean cosine of the velocity vectors (≥ 0.8). When the follower retraces the
   leader's path, the follower's heading is compared with the leader's heading *lag seconds earlier*, so
   following around a corner is not lost while the two briefly walk in different directions.
3. **Speed consistency** — slower ÷ faster speed (≥ 0.55).
4. **Relative position** — the follower must be *behind* the leader (inside a ±45° cone) for ≥ 70 % of the
   window, measured along the leader's heading and along the leader's path (from where the leader was
   *lag* seconds ago to where it is now). People mostly *beside* each other are group walking.
5. **Trajectory similarity with lag** — for lags 0.4–6 s the follower's path is compared with the
   leader's path *lag seconds earlier*; the best lag gives a similarity `exp(-d²/2σ²)`. A follower walks
   through the places the leader just walked through, which parallel walkers do not.
6. **Temporal consistency** — a following *event* is raised only when the window-level classification
   stays "potential following" for `min_following_duration_sec` (default 5 s), tolerating short gaps
   (`gap_tolerance_sec`). Leader/follower roles are decided per window from the behind-ratio.

Following is **many-to-many**: every pair is evaluated on its own, so one person can follow several
people (e.g. two friends walking side by side), several people can follow the same person, and in a
chain `3 → 2 → 1` person 2 is a follower and a leader at once. The annotated video labels each person
with all of their links (`FOLLOWS 1,2`, `FOLLOWED BY 3`, or both); links implied by a chain (`3 → 1`)
are drawn as thin arrows.

Confidence = weighted window score (direction, speed, trajectory similarity, behind ratio) scaled by
event duration and the share of positive windows. All thresholds are editable in **Settings**.

## Person photos

`app/core/photos.py` keeps, for every tracked person, the best picture seen so far: bigger, more confident,
fully inside the frame, and preferably with a frontal face (OpenCV Haar cascade on the head region; when no
face is found — small or turned-away heads are common on CCTV — the head region of the person box is used).
When a following event opens, updates or closes, the photos of both people are written to
`data/snapshots/job_<job>_<event>_<follower|leader>_<face|person>.jpg` and served by
`GET /api/events/following/{id}/photo/{follower|leader}.jpg?kind=face|person`.

## Running locally

Requirements: Python 3.10+ (tested on 3.13), Node 18+.

```bash
# backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend (dev server with proxy to :8000)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

On Windows `start.bat` opens both. The YOLO weights (`yolo11n.pt`) download automatically on first use.
Without `FS_DATABASE_URL` a SQLite file is created in `backend/data/`; for PostgreSQL copy
`backend/.env.example` to `backend/.env` and set the URL. API docs: <http://localhost:8000/docs>.

If `frontend/dist` exists (after `npm run build`) the backend also serves the dashboard on port 8000.

### Command-line analysis

```bash
cd backend
python scripts/analyze_video.py ../video.mp4 --out annotated.mp4 --snapshots snaps/
python scripts/analyze_video.py rtsp://user:pass@cam/stream --settings '{"tracker":"botsort"}'
```

### Docker (PostgreSQL + app)

```bash
docker compose up --build      # http://localhost:8000
```

For a GPU host build with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu121`, run with
the NVIDIA runtime and set `FS_DEVICE=0`.

### Tests

```bash
cd backend
python -m pytest -q
```

Engine tests use synthetic trajectories (curved-path following, following around a 90° corner, chains,
one person following several, several following one, side-by-side groups, parallel lanes, crossing paths,
opposite directions, short following, standing people, a 40-person crowd); crowd/motion tests cover
congestion clustering, overcrowding alerts, camera-pan compensation and photo capture; the API test
uploads a video and exercises every endpoint including the PDF report and the event photos.

## Results on the test footage

Two handheld iPhone clips of a busy campus plaza (portrait, 120 fps) were used for testing; real
deployments will use fixed CCTV angles, which are easier (no camera motion).

| Clip | Length | Camera motion | Peak / avg people | Following | Groups | Crowd alerts |
|---|---|---|---|---|---|---|
| IMG_7706 (high view, dense crowd) | 35.7 s | 421 px | 40 / 31 | 0 | 5 | 1 congestion |
| IMG_7595 (low view, strong pans, 4K HEVC) | 31.5 s | ≈3500 px | 30 / 21 | 0 | 1 | 3 congestion |

Nobody follows anybody in these clips, so they only show that an ordinary crowd does not raise alerts.
(The IMG_7595 row was measured with an earlier version and has not been re-run.)

**Following inside a real crowd.** To test detection where the answer is known, four walkers (cut-outs of
real people from the same footage) were inserted into 19.6 s of IMG_7706 along a scripted, curved route:
two people side by side, a third following both, and a fourth following the third. Real passers-by occlude
them and the camera keeps its handheld motion. Result: all 3 scripted links were raised (73–90 %
confidence, about 9 s after the walkers appear) plus the chain-implied link, and none of the other ~135
tracked people produced a following alert. This is a staged scenario — it shows the pipeline end to end, it
is not an accuracy figure for real CCTV. On other routes through the same crowd a link was missed when a
walker passed directly behind a standing group and lost its track.

Camera motion compensation matters: on the first 12 s of IMG_7595 *without* it, panning made standing
people look like they walked together and produced 11 false "potential following" pairs; with it, 0.
Feeding the same motion estimate into the tracker's Kalman prediction raised the average number of
continuously tracked people from 19.4 to 24.3 and reduced ID fragmentation.

## Configuration notes for real cameras

- **Crowd levels** (`crowd_warning_count`, `crowd_critical_count`) depend on how much of the scene a
  camera sees — set them per site.
- **CCTV live** — streams are analysed at `live_image_size` (default 640 px) instead of `image_size`, because
  a tracker needs several frames per second to keep its IDs; lost tracks are remembered for
  `occlusion_buffer_sec` of wall time whatever the achieved frame rate is.
- **CPU vs GPU** — on a laptop CPU, YOLO11n runs ≈ 1.5–2.5 analysed frames/s at 1280 px and ≈ 3.5 at 640 px. Recorded video is
  sampled at `target_fps` (default 15), so analysis is slower than real time on CPU; a GPU gives real-time
  processing for live streams. Live streams always analyse the newest frame and drop stale ones.
- **Dense crowds** — enable `detection_mode = tiled` (and ideally a GPU) for small, distant people.
- **Fixed CCTV** — camera motion compensation automatically stays at identity when the camera is static.

## Limitations

- Following detection measures movement similarity, not intent; people in a queue or walking the same
  corridor single-file can be flagged and must be reviewed.
- Heavy occlusion and ID switches in crowds can break or merge trajectories; a following link is lost
  when either person's track breaks.
- An alert needs about 9 s of consistent following (4 s analysis window + 5 s minimum duration).
- Face crops are only as good as the camera: distant or turned-away people give a head crop, not a face.
- Live analysis has been tested with a simulated HTTP camera stream, not yet with a physical RTSP camera.
- Very dense, distant crowds (people ≈ 10 px tall) are beyond a person detector; a density-estimation
  model would be needed for exact counts there.
- Pixel-space analysis (no ground-plane calibration): strong perspective makes distances approximate.
- Camera motion compensation assumes a mostly planar/distant background; long handheld recordings
  accumulate small drift.

## Privacy

Anonymous numeric track IDs only, no facial recognition or identity matching. Photos of the two people of a
following event **are stored** (they are personal data — follow your local CCTV / data-protection rules and
restrict who can open the dashboard; it has no login of its own). Uploaded videos, annotated outputs,
snapshots and photos live under `FS_DATA_DIR` and are deleted with the video or the analysis
(Video Management → delete removes the video, analyses, events and files).
