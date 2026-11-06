
// ============================================
// SOIL MOISTURE DASHBOARD
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

// ============================================
// BLUETOOTH VARIABLES
// ============================================

let device = null;
let characteristic = null;
let receiveBuffer = '';

// ============================================
// HTML ELEMENTS
// ============================================

const $ = id => document.getElementById(id);

const el = {
  pill: $('connectionPill') || $('pill'),
  connect: $('connectBtn') || $('connect'),
  disconnect: $('disconnectBtn') || $('disconnect'),
  hint: $('connectionHint') || $('hint'),
  sensorHint: $('sensorHint'),
  moisture: $('moistureValue') || $('moisture'),
  status: $('statusValue') || $('status'),
  raw: $('rawValue') || $('raw'),
  activeMode: $('activeModeLabel') || $('activeMode'),
  target: $('targetRange') || $('target'),
  gauge: $('gauge'),
  lowValue: $('lowValue'),
  highValue: $('highValue'),
  saved: $('savedLabel') || $('saved'),
  deviceName: $('deviceName'),
  modeHint: $('modeHint'),
  settingsHint: $('settingsHint')
};

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
    el.target.textContent = `${preset.low}% – ${preset.high}%`;
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
// LED COLOR MATCHING
// Matches Arduino RGB progression
// ============================================

function getMoistureColor(moisture) {
  const preset = presets[activeMode];

  const low = preset.low;
  const high = preset.high;

  // VERY DRY: RED
  if (moisture < 20) {
    return 'rgb(255, 0, 0)';
  }

  // NEEDS WATER: ORANGE
  else if (moisture < low) {
    const t = (moisture - 20) / Math.max(1, low - 20);

    const r = 255;
    const g = Math.round(10 + 20 * t);

    return `rgb(${r}, ${g}, 0)`;
  }

  // IDEAL RANGE: YELLOW TO GREEN
  else if (moisture <= high) {
    const t = (moisture - low) / Math.max(1, high - low);

    const r = Math.round(255 * (1 - t));
    const g = Math.round(30 + 225 * t);

    return `rgb(${r}, ${g}, 0)`;
  }

  // TOO WET: GREEN TO BLUE
  else if (moisture <= 80) {
    const t = (moisture - high) / Math.max(1, 80 - high);

    const g = Math.round(255 * (1 - t));
    const b = Math.round(255 * t);

    return `rgb(0, ${g}, ${b})`;
  }

  // MAXIMUM MOISTURE: PURE BLUE
  return 'rgb(0, 0, 255)';
}

// ============================================
// MOISTURE STATUS
// ============================================

function moistureStatus(value) {
  const preset = presets[activeMode];

  if (value < 20) {
    return 'Very Dry';
  }

  if (value < preset.low) {
    return 'Dry - Add Water';
  }

  if (value <= preset.high) {
    return 'Ideal Moisture';
  }

  if (value <= 80) {
    return 'Too Wet';
  }

  return 'Very Wet';
}

// ============================================
// UPDATE MOISTURE DISPLAY
// ============================================

function updateMoisture(value, rawValue = null) {
  value = Math.max(0, Math.min(100, Number(value)));

  const color = getMoistureColor(value);
  const status = moistureStatus(value);

  if (el.moisture) {
    el.moisture.textContent = `${Math.round(value)}%`;
  }

  if (el.status) {
    el.status.textContent = status;
  }

  if (el.raw && rawValue !== null) {
    el.raw.textContent = rawValue;
  }

  // Apply matching color to the gauge
  if (el.gauge) {
    el.gauge.style.setProperty('--gauge-color', color);
    el.gauge.style.setProperty('--moisture-color', color);
  }

  // Apply matching color to other indicators
  document.querySelectorAll('.moisture-color').forEach(element => {
    element.style.color = color;
  });
}

// ============================================
// BLUETOOTH SEND
// ============================================

async function sendLine(line) {
  if (!characteristic) return;

  try {
    const data = encoder.encode(line + '\n');

    if (characteristic.properties.write) {
      if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(data);
      } else {
        await characteristic.writeValue(data);
      }
    } else if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(data);
    }

  } catch (error) {
    console.error('Bluetooth send error:', error);

    if (el.hint) {
      el.hint.textContent = 'Unable to send command.';
    }
  }
}

// ============================================
// CHANGE GROWING MODE
// ============================================

async function setMode(mode) {
  if (!presets[mode]) return;

  activeMode = mode;

  updateSettingsUI();

  // Update gauge immediately using the new mode
  if (el.moisture) {
    const currentValue = parseFloat(el.moisture.textContent);

    if (!Number.isNaN(currentValue)) {
      updateMoisture(currentValue);
    }
  }

  if (el.saved) {
    el.saved.textContent = 'Updating...';
  }

  if (characteristic) {
    await sendLine(`MODE;${mode}`);
    await sendLine('GET');

    if (el.modeHint) {
      el.modeHint.textContent = 'Mode sent to sensor.';
    }
  } else {
    if (el.modeHint) {
      el.modeHint.textContent =
        'Mode selected. Connect to sync with sensor.';
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

  // LIVE SENSOR DATA
  if (type === 'DATA') {
    if (presets[data.MODE]) {
      activeMode = data.MODE;
      updateSettingsUI();
    }

    if (data.MOISTURE !== undefined) {
      updateMoisture(
        Number(data.MOISTURE),
        data.RAW !== undefined ? data.RAW : null
      );
    }

    if (el.saved) {
      el.saved.textContent = 'Synced';
    }
  }

  // MODE SETTINGS
  else if (type === 'SETTINGS') {
    if (presets[data.MODE]) {
      activeMode = data.MODE;
      updateSettingsUI();
    }

    if (el.saved) {
      el.saved.textContent = 'Synced';
    }
  }
}

// ============================================
// RECEIVE BLUETOOTH DATA
// ============================================

function handleBluetoothData(event) {
  const value = decoder.decode(event.target.value);

  receiveBuffer += value;

  const lines = receiveBuffer.split('\n');

  receiveBuffer = lines.pop();

  lines.forEach(line => {
    parseLine(line);
  });
}

// ============================================
// CONNECT TO HM-10
// ============================================

async function connectToHM10() {
  try {
    if (!navigator.bluetooth) {
      throw new Error(
        'Bluetooth is not supported in this browser. Try a compatible BLE browser.'
      );
    }

    if (el.hint) {
      el.hint.textContent = 'Searching for sensor...';
    }

    device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID] }
      ]
    });

    device.addEventListener(
      'gattserverdisconnected',
      disconnectFromHM10
    );

    if (el.deviceName) {
      el.deviceName.textContent = device.name || 'HM-10 Sensor';
    }

    const server = await device.gatt.connect();

    const service = await server.getPrimaryService(SERVICE_UUID);

    characteristic = await service.getCharacteristic(
      CHARACTERISTIC_UUID
    );

    await characteristic.startNotifications();

    characteristic.addEventListener(
      'characteristicvaluechanged',
      handleBluetoothData
    );

    if (el.pill) {
      el.pill.textContent = 'Connected';
      el.pill.classList.add('connected');
    }

    if (el.hint) {
      el.hint.textContent = 'Connected to soil monitor.';
    }

    if (el.sensorHint) {
      el.sensorHint.textContent = 'Live sensor data';
    }

    if (el.connect) {
      el.connect.hidden = true;
    }

    if (el.disconnect) {
      el.disconnect.hidden = false;
    }

    await sendLine(`MODE;${activeMode}`);
    await sendLine('GET');

  } catch (error) {
    console.error('Bluetooth connection error:', error);

    if (el.hint) {
      el.hint.textContent = error.message;
    }
  }
}

// ============================================
// DISCONNECT
// ============================================

function disconnectFromHM10() {
  characteristic = null;
  receiveBuffer = '';

  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }

  if (el.pill) {
    el.pill.textContent = 'Disconnected';
    el.pill.classList.remove('connected');
  }

  if (el.hint) {
    el.hint.textContent = 'Connect to your soil monitor.';
  }

  if (el.sensorHint) {
    el.sensorHint.textContent = 'Waiting for sensor connection';
  }

  if (el.connect) {
    el.connect.hidden = false;
  }

  if (el.disconnect) {
    el.disconnect.hidden = true;
  }
}

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
