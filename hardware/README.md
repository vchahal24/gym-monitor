# GymTracker

Two ESP32 machine nodes read their accelerometers at 50 Hz. Each sends its state to a USB-connected Digi XBee Zigbee coordinator. The PC terminal shows the machine name, state, time of arrival, and dynamic acceleration at the node when the packet was sent.

## Live display

Connect the coordinator's USB adapter and power the nodes. Double-click **Start GymTracker.cmd**, or run the following from this directory.

```powershell
uv run --python 3.11 coordinator.py
```

The monitor recognizes the project's FTDI adapter. Use `--port COM7` if you have multiple adapters, substituting the current port if Windows reassigns it. Use `--check-links` to request each reporting radio's firmware version over Zigbee. Only one terminal can open the coordinator port at a time.

The terminal prints state changes as they arrive. Each node also sends a five-second heartbeat so a newly opened terminal can display its current state. Identical heartbeats are silent. A node starts as **WAITING** until its first packet and shows **OFFLINE** after 16 seconds without a packet. **SENSOR_ERROR** means the ESP32 cannot read its accelerometer.

## Motion detection

| Machine state | Condition |
| --- | --- |
| AVAILABLE | Initial state after a valid sample, or three seconds since the last confirmed movement |
| ACTIVE | Four consecutive samples reach at least 0.10 g of dynamic acceleration |
| RESTING | An active machine has gone 0.4 seconds without confirmed movement |

Movement during RESTING returns the machine to ACTIVE. The three-second timer starts at the last confirmed movement, so it includes the resting interval. A slowly updated three-axis gravity estimate lets the two boards use different mounting orientations. Tune `thresholdG` and `restTimeoutMs` in `include/motion.h` after mounting the sensors on the machines.

## Hardware and firmware

| Machine | ESP32 base MAC | Accelerometer I²C address | WHO_AM_I |
| --- | --- | --- | --- |
| 1 | 24:DC:C3:45:8A:78 | 0x68 | 0x68 |
| 2 (replacement ESP32) | AC:15:18:EB:F9:18 | 0x68 | 0x98 |

Both use GPIO21 for SDA, GPIO22 for SCL, GPIO16 for XBee DOUT, and GPIO17 for XBee DIN. Each breakout uses 3V3 and common ground. The firmware recognizes both observed sensor IDs. Machine labels in `coordinator.py` are keyed by ESP32 base MAC and survive USB port changes.

To build and upload the same firmware to either node, select the **ESP32** port for the upload.

```powershell
uvx --python 3.11 --from platformio pio run
uvx --python 3.11 --from platformio pio run -t upload --upload-port COM4
```

The node configures its local XBee as a router on extended PAN `0x47594D31` (GYM1). This bench network uses `EE=0` (unencrypted Zigbee). For a replacement coordinator, use the command below with the **USB XBee adapter** port. Setup saves the coordinator role, PAN, and encryption setting in the radio. The monitor uses 9600 baud and the node radios support API or transparent mode at the common UART speeds listed in `src/radio.cpp`.

```powershell
uv run --python 3.11 coordinator.py --port COM7 --setup --check-links
```

For a bench check, move a sensor continuously for about one second, then leave it still for four seconds. The terminal should show ACTIVE, RESTING, and AVAILABLE for that machine; another movement during RESTING should return it to ACTIVE.
