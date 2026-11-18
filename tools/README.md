# Verification suite for Vice Meridian II.
#
# Four scripts, each answering a different question, all driving the real game in headless Chromium
# with SwiftShader so they run anywhere:
#
#   shoot.py   render the four hand-in photographs from ?shot=cover|foot|mission|driving
#   check.py   measure what each render shows (panels painted, stars lit, dispatch lines, beam
#              brightness) and fail on a thin frame
#   verify.py  prove what is on screen by occlusion: hide one subject, render again, diff the pixels
#              so a subject's footprint is a measurement rather than an assumption
#   play.py    play the game and assert what a still frame cannot show: walking, traffic, stealing,
#              crashing, shooting, a four-star chase with the helicopter, shops, the mission chain,
#              the clock, cooling heat and an arrest
#
# Usage, with the game already served (node serve.ts, or --port and adjust the URL):
#
#   node serve.ts --port 8123 &
#   python3 tools/shoot.py http://127.0.0.1:8123 screenshots
#   for s in cover foot mission driving; do python3 tools/check.py $s; done
#   python3 tools/verify.py cover
#   python3 tools/play.py
#
# Requires playwright and Pillow (see tools/requirements.txt). These are development tools: they live
# outside game/ and are never part of the hand-in.
