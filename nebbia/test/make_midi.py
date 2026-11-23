"""Writes demo/dub_stabs.mid: 4 bars of off-beat stabs (A A F G) to drag onto a NEBBIA track."""
import os
import struct

PPQ = 480


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


events = []  # (tick, bytes)
for bar, root in enumerate([57, 57, 53, 55]):
    for b in range(4):
        t = (bar * 4 + b) * PPQ + PPQ // 2
        vel = 85 + ((b * 37 + bar * 11) % 30)
        events.append((t, bytes([0x90, root, vel])))
        events.append((t + PPQ // 4, bytes([0x80, root, 0])))
events.sort(key=lambda e: (e[0], e[1][0] == 0x90))
track = b"\x00\xff\x51\x03" + (500000).to_bytes(3, "big")  # 120 BPM
track += b"\x00\xff\x58\x04\x04\x02\x18\x08"
last = 0
for t, data in events:
    track += vlq(t - last) + data
    last = t
track += vlq(16 * PPQ - last) + b"\xff\x2f\x00"
smf = b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ) + b"MTrk" + struct.pack(">I", len(track)) + track
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "demo", "dub_stabs.mid")
with open(out, "wb") as f:
    f.write(smf)
print("wrote", os.path.normpath(out))
