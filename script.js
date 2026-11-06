// Soil Monitor — browser app with Web Bluetooth support.
// BLE UUIDs: HM-10 service FFE0, characteristic FFE1.
// Expected line from Arduino:
// DATA;MODE=UNDER_LIGHT;MOISTURE=50;RAW=310;LOW=35;HIGH=65
// Commands sent to Arduino: GET, MODE;UNDER_LIGHT, SET;UNDER_LIGHT;35;65, SAVE

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const presets = {
  GERMINATION: { label: 'Germination', low: 40, high: 70 },
  UNDER_LIGHT: { label: 'Under Light', low: 35, high: 65 },
  PRE_HARVEST: { label: 'Pre-Harvest', low: 30, high: 55 }
};

let activeMode = 'UNDER_LIGHT';
let modeSettings = JSON.parse(JSON.stringify(presets));
let device = null;
let characteristic = null;
let receiveBuffer = '';
let toastTimer = null;

const $ = id => document.getElementById(id);
const el = {
  pill: $('connectionPill'), connect: $('connectButton'), disconnect: $('disconnectButton'),
  hint: $('bleHint'), sensorHint: $('sensorHint'), moisture: $('moistureValue'),
  status: $('moistureStatus'), raw: $('rawValue'), activeMode: $('activeModeLabel'),
  target: $('targetRange'), gauge: $('gauge'), low: $('lowRange'), high: $('highRange'),
  lowValue: $('lowValue'), highValue: $('highValue'), saved: $('savedLabel'),
  deviceName: $('deviceName')
};

function notify(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function settings() { return modeSettings[activeMode]; }

function updateSettingsUI() {
  const s = settings();
  el.low.value = s.low;
  el.high.value = s.high;
  el.low.max = Math.max(0, s.high - 1);
  el.high.min = Math.min(100, s.low + 1);
  el.lowValue.textContent = s.low;
  el.highValue.textContent = s.high;
  el.target.textContent = `${s.low}–${s.high}%`;
  el.activeMode.textContent = presets[activeMode].label;
  document.querySelectorAll('.mode-card').forEach(button =>
    button.classList.toggle('selected', button.dataset.mode === activeMode)
  );
}

function setMode(mode, send = true) {
  if (!presets[mode]) return;
  activeMode = mode;
  updateSettingsUI();
  el.saved.textContent = 'Not saved';
  if (send && characteristic) {
    sendLine(`MODE;${mode}`).then(() => sendLine('GET')).catch(showBluetoothError);
  }
}

function moistureStatus(value, low, high) {
  if (value < 10) return ['Very Dry', '#e78a76'];
  if (value < low) return ['Dry - Add Water', '#f0b76b'];
  if (value <= high) return ['Ideal Moisture', '#8ed6a0'];
  if (value <= Math.min(100, high + 15)) return ['Too Wet', '#75c9c4'];
  return ['Very Wet', '#78b8e9'];
}

function updateMoisture(value, raw) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  const n = Math.max(0, Math.min(100, number));
  el.moisture.textContent = Math.round(n);
  if (raw !== undefined && raw !== '') el.raw.textContent = raw;
  const [label, color] = moistureStatus(n, settings().low, settings().high);
  el.status.textContent = label;
  el.status.style.color = color;
  const angle = n * 3.6;
  el.gauge.style.background = `conic-gradient(${color} ${angle}deg, #294334 ${angle}deg 360deg)`;
  el.sensorHint.textContent = 'Receiving readings from your soil sensor.';
}

function parseLine(line) {
  const parts = line.trim().split(';');
  if (!parts[0]) return;
  const fields = {};
  for (const part of parts.slice(1)) {
    const index = part.indexOf('=');
    if (index > 0) fields[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }

  if (parts[0] === 'DATA') {
    if (fields.MODE && presets[fields.MODE]) activeMode = fields.MODE;
    if (fields.LOW !== undefined && fields.HIGH !== undefined && presets[activeMode]) {
      modeSettings[activeMode] = { low: Number(fields.LOW), high: Number(fields.HIGH) };
    }
    updateSettingsUI();
    if (fields.MOISTURE !== undefined) updateMoisture(fields.MOISTURE, fields.RAW);
  } else if (parts[0] === 'SETTINGS') {
    const mode = fields.MODE || activeMode;
    if (presets[mode] && fields.LOW !== undefined && fields.HIGH !== undefined) {
      modeSettings[mode] = { low: Number(fields.LOW), high: Number(fields.HIGH) };
      activeMode = mode;
      updateSettingsUI();
      el.saved.textContent = 'Synced';
    }
  }
}

function onNotification(event) {
  receiveBuffer += decoder.decode(event.target.value);
  const lines = receiveBuffer.split(/\\r?\\n/);
  receiveBuffer = lines.pop() || '';
  lines.forEach(parseLine);
}

async function sendLine(line) {
  if (!characteristic) throw new Error('Not connected to the HM-10.');
  const bytes = encoder.encode(line + '\\n');
  if (characteristic.properties.write) {
    await characteristic.writeValueWithResponse(bytes);
  } else if (characteristic.properties.writeWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    throw new Error('The HM-10 characteristic does not allow writing.');
  }
}

function showBluetoothError(error) {
  const message = error && error.message ? error.message : String(error);
  el.hint.textContent = message;
  notify(message.length > 85 ? 'Bluetooth error. Read the message under the connection controls.' : message);
}

async function connectToHM10() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is unavailable in this browser. Open the hosted HTTPS page in Bluefy.');
  }
  el.hint.textContent = 'Choose the HM-10 in the Bluetooth device picker.';
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID]
  });
  device.addEventListener('gattserverdisconnected', onDisconnected);
  el.deviceName.textContent = device.name || 'HM-10';
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

  if (characteristic.properties.notify || characteristic.properties.indicate) {
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', onNotification);
  }
  el.pill.classList.add('connected');
  $('connectionText').textContent = 'Connected';
  el.connect.disabled = true;
  el.disconnect.disabled = false;
  el.hint.textContent = 'Connected. Waiting for sensor data…';
  notify('Connected to ' + (device.name || 'HM-10'));
  await sendLine('GET');
}

function onDisconnected() {
  characteristic = null;
  el.pill.classList.remove('connected');
  $('connectionText').textContent = 'Not connected';
  el.connect.disabled = false;
  el.disconnect.disabled = true;
  el.hint.textContent = 'Bluetooth disconnected. Tap Connect to reconnect.';
}
function disconnect() {
  if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
  onDisconnected();
}

document.querySelectorAll('.mode-card').forEach(button => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

el.low.addEventListener('input', () => {
  const low = Number(el.low.value);
  const high = Number(el.high.value);
  modeSettings[activeMode].low = Math.min(low, high - 1);
  updateSettingsUI();
  el.saved.textContent = 'Unsaved';
});
el.high.addEventListener('input', () => {
  const high = Number(el.high.value);
  const low = Number(el.low.value);
  modeSettings[activeMode].high = Math.max(high, low + 1);
  updateSettingsUI();
  el.saved.textContent = 'Unsaved';
});

$('saveButton').addEventListener('click', async () => {
  const s = settings();
  if (!characteristic) {
    el.saved.textContent = 'Local only';
    $('settingsHint').textContent = 'Settings are changed on this page, but the sensor is not connected. Connect HM-10 to send them.';
    notify('Settings updated on this page. Connect HM-10 to send them to Arduino.');
    return;
  }
  try {
    await sendLine(`SET;${activeMode};${s.low};${s.high}`);
    await sendLine('SAVE');
    el.saved.textContent = 'Sent to sensor';
    $('settingsHint').textContent = 'Settings command sent to the Arduino.';
    notify('Settings sent to your sensor.');
  } catch (error) { showBluetoothError(error); }
});

el.connect.addEventListener('click', () => connectToHM10().catch(showBluetoothError));
el.disconnect.addEventListener('click', disconnect);

updateSettingsUI();
