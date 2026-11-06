SOIL MONITOR WEBSITE

Files:
- index.html: page structure
- style.css: visual styling
- script.js: growing modes, threshold controls, and HM-10 Bluetooth code

HOW TO PREVIEW:
Open index.html in a desktop browser to inspect the design. Bluetooth will not work from a local file.

HOW TO USE WITH BLUEFY:
1. Host these three files on an HTTPS website (for example, GitHub Pages).
2. Open the HTTPS website in Bluefy on your iPhone.
3. Tap Connect to HM-10 and select your module.
4. The HM-10 must expose BLE service FFE0 and characteristic FFE1.
5. The characteristic must support notifications/indications for incoming sensor data and writes for commands.

EXPECTED ARDUINO DATA LINE:
DATA;MODE=UNDER_LIGHT;MOISTURE=50;RAW=310;LOW=35;HIGH=65

COMMANDS THIS PAGE SENDS:
GET
MODE;GERMINATION
MODE;UNDER_LIGHT
MODE;PRE_HARVEST
SET;UNDER_LIGHT;35;65
SAVE

IMPORTANT:
The Bluetooth code assumes the Arduino sends newline-terminated text lines and supports the commands above. Your current Arduino sketch must actually implement this exact protocol. If its format differs, update script.js to match it. UUIDs are written in full 128-bit form; the BLE API normalizes the short HM-10 UUIDs FFE0/FFE1 to these values.
Bluefy's Web Bluetooth support and device compatibility should be tested on your specific iPhone and HM-10 firmware. This website does not guarantee every HM-10 clone supports the same GATT behavior.
