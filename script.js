// ============================================
// TERRA SENSE
// HM-10 Bluetooth + Automatic Growing Profiles
// ============================================

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ============================================
// GROWING MODE PRESETS
// ============================================

const presets = {
  GERMINATION: {
    label: 'Germination',
    low: 40,
    high: 70
  },

  UNDER_LIGHT: {
    label: 'Under Light',
    low: 35,
    high: 65
  },

  PRE_HARVEST: {
    label: 'Pre-Harvest',
    low: 30,
    high: 55
  }
};

let activeMode = 'UNDER_LIGHT';
let currentMoisture = null;

// ============================================
// BLUETOOTH VARIABLES
// ============================================

let device = null;
let characteristic = null;
let receiveBuffer = '';
let lastDataAt = null;

// ============================================
// HTML ELEMENTS
// ============================================

const $ = id => document.getElementById(id);

const el = {
  pill: $('connectionPill'),
  connectionText: $('connectionText'),
  connect: $('connectButton'),
  disconnect: $('disconnectButton'),
  hint: $('bleHint'),
  sensorHint: $('sensorHint'),
  dataStatus: $('dataStatus'),
  dataIndicator: document.querySelector('.data-indicator'),
  moisture: $('moistureValue'),
  status: $('moistureStatus'),
  raw: $('rawValue'),
  activeMode: $('activeModeLabel'),
  target: $('targetRange'),
  gauge: $('gauge'),
  lowValue: $('lowValue'),
  highValue: $('highValue'),
  saved: $('savedLabel'),
  deviceName: $('deviceName'),
  modeHint: $('modeHint'),
  settingsHint: $('settingsHint'),
  toast: $('toast')
};

// ============================================
// TOAST MESSAGE
// ============================================

function showToast(message) {
  if (!el.toast) return;

  el.toast.textContent = message;
  el.toast.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    el.toast.classList.remove('show');
  }, 2800);
}

// ============================================
// CONNECTION DISPLAY
// ============================================

function setConnectionState(state, message) {
  if (el.connectionText) {
    el.connectionText.textContent = message;
  }

  if (el.pill) {
    el.pill.classList.remove('connected', 'connecting');

    if (state === 'connected') {
      el.pill.classList.add('connected');
    }

    if (state === 'connecting') {
      el.pill.classList.add('connecting');
    }
  }

  if (el.connect) {
    el.connect.hidden = state === 'connected';
    el.connect.disabled = state === 'connecting';
  }

  if (el.disconnect) {
    el.disconnect.hidden = state !== 'connected';
    el.disconnect.disabled = state !== 'connected';
  }
}

// ============================================
// DATA RECEPTION DISPLAY
// ============================================

function setDataState(state, message) {
  if (el.dataStatus) {
    el.dataStatus.textContent = message;
  }

  if (el.dataIndicator) {
    el.dataIndicator.classList.remove('live', 'stale');

    if (state === 'live') {
      el.dataIndicator.classList.add('live');
    }

    if (state === 'stale') {
      el.dataIndicator.classList.add('stale');
    }
  }
}

// ============================================
// UPDATE MODE DISPLAY
// ============================================

function updateSettingsUI() {
  const preset = presets[activeMode];

  if (!preset) return;

  if (el.lowValue) {
    el.lowValue.textContent = `${preset.low}%`;
  }

  if (el.highValue) {
    el.highValue.textContent = `${preset.high}%`;
  }

  if (el.target) {
    el.target.textContent = `${preset.low}–${preset.high}%`;
  }

  if (el.activeMode) {
    el.activeMode.textContent = preset.label;
  }

  document.querySelectorAll('[data-mode]').forEach(card => {
    const selected = card.dataset.mode === activeMode;

    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
}

// ============================================
// MOISTURE COLOR
// ============================================

function getMoistureColor(moisture) {
  const preset = presets[activeMode];

  const low = preset.low;
  const high = preset.high;

  // Very dry: red
  if (moisture < 20) {
    return 'rgb(255, 0, 0)';
  }

  // Dry: orange
  if (moisture < low) {
    const t = (moisture - 20) / Math.max(1, low - 20);

    return `rgb(255, ${Math.round(10 + 20 * t)}, 0)`;
  }

  // Ideal: yellow to green
  if (moisture <= high) {
    const t = (moisture - low) / Math.max(1, high - low);

    const r = Math.round(255 * (1 - t));
    const g = Math.round(30 + 225 * t);

    return `rgb(${r}, ${g}, 0)`;
  }

  // Too wet: green to blue
  if (moisture <= 80) {
    const t = (moisture - high) / Math.max(1, 80 - high);

    const g = Math.round(255 * (1 - t));
    const b = Math.round(255 * t);

    return `rgb(0, ${g}, ${b})`;
  }

  // Maximum moisture: pure blue
  return 'rgb(0, 0, 255)';
}

// ============================================
// MOISTURE STATUS
// ============================================

function getMoistureStatus(value) {
  const preset = presets[activeMode];

  if (value < 20) return 'Very Dry';
  if (value < preset.low) return 'Dry - Add Water';
  if (value <= preset.high) return 'Ideal Moisture';
  if (value <= 80) return 'Too Wet';

  return 'Very Wet';
}

// ============================================
// UPDATE MOISTURE DISPLAY
// ============================================

function updateMoisture(value, rawValue = null) {
  value = Number(value);

  if (!Number.isFinite(value)) return;

  value = Math.max(0, Math.min(100, value));

  currentMoisture = value;

  const color = getMoistureColor(value);
  const status = getMoistureStatus(value);

  if (el.moisture) {
    el.moisture.textContent = Math.round(value);
  }

  if (el.status) {
    el.status.textContent = status;
  }

  if (el.raw && rawValue !== null) {
    el.raw.textContent = rawValue;
  }

  if (el.gauge) {
    el.gauge.style.setProperty('--gauge-color', color);
    el.gauge.style.setProperty(
      '--gauge-angle',
      `${value * 3.6}deg`
    );
  }
}

// ============================================
// SEND COMMAND TO ARDUINO
// ============================================

async function sendLine(line) {
  if (!characteristic) {
    return false;
  }

  try {
    const data = encoder.encode(line + '\n');
    const properties = characteristic.properties;

    if (properties.write) {
      if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(data);
      } else {
        await characteristic.writeValue(data);
      }
    } else if (properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(data);
    } else {
      throw new Error('Bluetooth characteristic cannot accept commands.');
    }

    return true;

  } catch (error) {
    console.error('Bluetooth send error:', error);

    if (el.hint) {
      el.hint.textContent = 'Could not send command to the sensor.';
    }

    showToast('Unable to send Bluetooth command.');

    return false;
  }
}

// ============================================
// CHANGE GROWING MODE
// ============================================

async function setMode(mode) {
  if (!presets[mode]) return;

  activeMode = mode;

  updateSettingsUI();

  if (currentMoisture !== null) {
    updateMoisture(currentMoisture);
  }

  if (el.saved) {
    el.saved.textContent = 'Updating settings...';
  }

  if (characteristic) {
    const sent = await sendLine(`MODE;${mode}`);

    if (sent) {
      await sendLine('GET');

      if (el.modeHint) {
        el.modeHint.textContent =
          `${presets[mode].label} selected and sent to sensor.`;
      }

      if (el.settingsHint) {
        el.settingsHint.textContent =
          'Waiting for Arduino confirmation.';
      }
    }

  } else {
    if (el.modeHint) {
      el.modeHint.textContent =
        `${presets[mode].label} selected. Connect to sync with sensor.`;
    }

    if (el.saved) {
      el.saved.textContent = 'Selected — not synced';
    }
  }
}

// ============================================
// PARSE ARDUINO DATA
// ============================================

function parseLine(line) {
  line = line.trim();

  if (!line) return;

  const parts = line.split(';');
  const type = parts.shift();

  const data = {};

  parts.forEach(part => {
    const separator = part.indexOf('=');

    if (separator !== -1) {
      const key = part.substring(0, separator);
      const value = part.substring(separator + 1);

      data[key] = value;
    }
  });

  // LIVE SENSOR READING
  if (type === 'DATA') {
    if (presets[data.MODE]) {
      activeMode = data.MODE;
      updateSettingsUI();
    }

    if (data.MOISTURE !== undefined) {
      updateMoisture(
        data.MOISTURE,
        data.RAW !== undefined ? data.RAW : null
      );

      lastDataAt = Date.now();

      setDataState('live', 'Receiving live sensor data');

      if (el.sensorHint) {
        el.sensorHint.textContent =
          'Your sensor is actively transmitting readings.';
      }
    }

    if (el.saved) {
      el.saved.textContent = 'Synced with Arduino';
    }
  }

  // MODE SETTINGS CONFIRMATION
  else if (type === 'SETTINGS') {
    if (presets[data.MODE]) {
      activeMode = data.MODE;
      updateSettingsUI();
    }

    if (el.saved) {
      el.saved.textContent = 'Settings confirmed';
    }

    if (el.settingsHint) {
      el.settingsHint.textContent =
        'Arduino has confirmed the selected settings.';
    }
  }
}

// ============================================
// RECEIVE BLUETOOTH DATA
// ============================================

function handleBluetoothData(event) {
  const value = event.target.value;

  const decoded = decoder.decode(value);

  receiveBuffer += decoded;

  const lines = receiveBuffer.split('\n');

  receiveBuffer = lines.pop();

  lines.forEach(line => {
    parseLine(line);
  });
}

// ============================================
// BLUETOOTH DISCONNECTED EVENT
// ============================================

function handleDeviceDisconnected() {
  characteristic = null;
  receiveBuffer = '';
  lastDataAt = null;

  setConnectionState('disconnected', 'Disconnected');

  setDataState('waiting', 'Waiting for sensor data');

  if (el.hint) {
    el.hint.textContent =
      'Sensor disconnected. Connect again to resume monitoring.';
  }

  if (el.sensorHint) {
    el.sensorHint.textContent =
      'Waiting for sensor connection.';
  }

  showToast('Sensor disconnected.');
}

// ============================================
// CONNECT TO HM-10
// ============================================

async function connectToHM10() {
  try {
    if (!navigator.bluetooth) {
      throw new Error(
        'Bluetooth is unavailable in this browser. Try Bluefy or another compatible BLE browser.'
      );
    }

    setConnectionState('connecting', 'Connecting...');

    if (el.hint) {
      el.hint.textContent = 'Searching for your HM-10 module...';
    }

    setDataState('waiting', 'Waiting for sensor data');

    // Allow device selection even if HM-10 does not advertise FFE0.
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    });

    if (el.deviceName) {
      el.deviceName.textContent = device.name || 'HM-10 Sensor';
    }

    device.removeEventListener(
      'gattserverdisconnected',
      handleDeviceDisconnected
    );

    device.addEventListener(
      'gattserverdisconnected',
      handleDeviceDisconnected
    );

    if (!device.gatt) {
      throw new Error('This device does not support a GATT connection.');
    }

    const server = await device.gatt.connect();

    const service = await server.getPrimaryService(SERVICE_UUID);

    characteristic = await service.getCharacteristic(
      CHARACTERISTIC_UUID
    );

    characteristic.addEventListener(
      'characteristicvaluechanged',
      handleBluetoothData
    );

    await characteristic.startNotifications();

    setConnectionState('connected', 'Connected');

    if (el.hint) {
      el.hint.textContent =
        'Connected to your Terra Sense soil monitor.';
    }

    if (el.sensorHint) {
      el.sensorHint.textContent =
        'Connected. Waiting for the first sensor reading.';
    }

    setDataState('waiting', 'Connected — waiting for readings');

    showToast('Connected to soil monitor.');

    // Synchronize the selected mode with Arduino.
    await sendLine(`MODE;${activeMode}`);
    await sendLine('GET');

  } catch (error) {
    console.error('Bluetooth connection error:', error);

    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
    }

    characteristic = null;

    setConnectionState('disconnected', 'Disconnected');

    if (error.name === 'NotFoundError') {
      if (el.hint) {
        el.hint.textContent =
          'No device selected. Press Connect Sensor to try again.';
      }
    } else {
      if (el.hint) {
        el.hint.textContent = error.message;
      }

      showToast(error.message);
    }
  }
}

// ============================================
// MANUAL DISCONNECT
// ============================================

function disconnectFromHM10() {
  if (device && device.gatt && device.gatt.connected) {
    device.gatt.disconnect();
  }

  handleDeviceDisconnected();
}

// ============================================
// CHECK FOR MISSING SENSOR DATA
// ============================================

setInterval(() => {
  if (!characteristic) return;

  if (lastDataAt === null) {
    setDataState('waiting', 'Connected — waiting for readings');
    return;
  }

  const elapsed = Date.now() - lastDataAt;

  if (elapsed > 3000) {
    setDataState('stale', 'No recent sensor data');

    if (el.sensorHint) {
      el.sensorHint.textContent =
        'Bluetooth is connected, but new readings have stopped.';
    }
  }
}, 1000);

// ============================================
// BUTTON EVENTS
// ============================================

document.querySelectorAll('[data-mode]').forEach(card => {
  card.addEventListener('click', () => {
    setMode(card.dataset.mode);
  });
});

if (el.connect) {
  el.connect.addEventListener('click', connectToHM10);
}

if (el.disconnect) {
  el.disconnect.addEventListener('click', disconnectFromHM10);
}

// ============================================
// INITIALIZE DASHBOARD
// ============================================

updateSettingsUI();

setConnectionState('disconnected', 'Disconnected');

setDataState('waiting', 'Waiting for sensor data');
