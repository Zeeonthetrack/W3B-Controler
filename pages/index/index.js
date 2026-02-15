const SERVICE_UUID = "0000FFE0-0000-1000-8000-00805F9B34FB";
const CHAR_UUID = "0000FFE1-0000-1000-8000-00805F9B34FB";

function formatTime(date) {
  const pad = (num) => num.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

Page({
  data: {
    connectStatus: "未连接",
    bleAvailable: false,
    isSearching: false,
    isConnected: false,
    deviceList: [],
    connectedDeviceId: "",
    lastDeviceId: "",
    writeCharacteristicId: "",
    serviceId: SERVICE_UUID,
    characteristicId: CHAR_UUID,
    filterDeviceName: "MySTM32Car",

    leftSpeed: 0,
    rightSpeed: 0,
    leftByte: 127,
    rightByte: 127,

    btnRed: 0,
    btnBlue: 0,
    btnGreen: 0,
    btnYellow: 0,

    // Dynamic interaction state
    leftVis: false,
    leftPos: { top: 0, left: 0 },
    rightVis: false,
    rightPos: { top: 0, left: 0 },
    leftStick: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    
    // UI state
    showLogs: false,
    logList: [],
    showSettings: false, 
    fontSizeMode: "mode-m", // Default medium font
    settings: {
      autoClearLog: false,
      autoReconnect: false
    }
  },

  // Internal state not for wxml binding
  padRect: { left: null, right: null },
  activeTouches: { left: null, right: null },

  onLoad() {
    const savedMode = wx.getStorageSync('fontSizeMode');
    if (savedMode) {
      this.setData({ fontSizeMode: savedMode });
    }
    this.initBluetooth();
  },

  onUnload() {
    this.disconnectDevice();
    wx.closeBluetoothAdapter();
  },

  // --- Bluetooth Logic ---

  initBluetooth() {
    wx.openBluetoothAdapter({
      success: () => {
        this.setData({ bleAvailable: true, connectStatus: "未连接" });
        wx.onBluetoothAdapterStateChange((res) => {
          if (!res.available) {
            this.setData({
              connectStatus: "蓝牙未开启",
              bleAvailable: false,
              isConnected: false
            });
          } else {
            this.setData({ bleAvailable: true, connectStatus: this.data.isConnected ? "已连接" : "未连接" });
          }
        });
      },
      fail: () => {
        this.setData({ bleAvailable: false, connectStatus: "蓝牙不可用" });
      }
    });
  },

  startSearch() {
    if (this.data.isSearching) return;
    if (!this.data.bleAvailable) {
      wx.showToast({ title: "请开启蓝牙", icon: "none" });
      return;
    }

    this.setData({ deviceList: [], isSearching: true });
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => {
        wx.showToast({ title: "搜索中...", icon: "loading" });
        wx.onBluetoothDeviceFound((res) => {
          res.devices.forEach((device) => {
            if (!device.name || device.name.indexOf(this.data.filterDeviceName) === -1) return;
            const list = this.data.deviceList;
            if (!list.some((item) => item.deviceId === device.deviceId)) {
              list.push(device);
              this.setData({ deviceList: list });
            }
          });
        });
        setTimeout(() => this.stopSearch(), 10000);
      },
      fail: () => {
        this.setData({ isSearching: false });
        wx.showToast({ title: "搜索失败", icon: "none" });
      }
    });
  },

  stopSearch() {
    wx.stopBluetoothDevicesDiscovery({
      success: () => this.setData({ isSearching: false })
    });
  },

  connectDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    this.connectDeviceById(deviceId);
  },

  reconnectLast() {
    if (this.data.lastDeviceId) {
      this.connectDeviceById(this.data.lastDeviceId);
    } else {
      wx.showToast({ title: "无历史设备", icon: "none" });
    }
  },

  connectDeviceById(deviceId) {
    if (!deviceId || this.data.isConnected) return;
    wx.showLoading({ title: "连接中..." });
    this.stopSearch();

    wx.createBLEConnection({
      deviceId,
      success: () => {
        this.setData({
          connectedDeviceId: deviceId,
          lastDeviceId: deviceId, // Save for reconnect
          connectStatus: "已连接",
          isConnected: true
        });
        wx.hideLoading();
        wx.showToast({ title: "连接成功" });

        setTimeout(() => this.getDeviceService(deviceId), 500);

        wx.onBLEConnectionStateChange((res) => {
          if (!res.connected) {
            this.setData({
              connectStatus: "断开",
              isConnected: false,
              connectedDeviceId: "",
              writeCharacteristicId: ""
            });
            if (this.data.settings.autoReconnect) {
               // Simple auto-reconnect logic could go here
            }
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "连接失败", icon: "none" });
      }
    });
  },

  getDeviceService(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        const service = res.services.find((item) => item.uuid.toUpperCase().includes(this.data.serviceId.substring(4, 8))); // Loose matching or exact
        // The original code used exact match
        const exactService = res.services.find((item) => item.uuid.toUpperCase() === this.data.serviceId.toUpperCase());
        
        if (exactService) {
           this.getDeviceCharacteristic(deviceId, exactService.uuid);
        } else {
           // Fallback to first likely service if needed, but strict is better
           wx.showToast({ title: "服务未找到", icon: "none" }); 
        }
      }
    });
  },

  getDeviceCharacteristic(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        const char = res.characteristics.find(
          (item) => item.uuid.toUpperCase() === this.data.characteristicId.toUpperCase()
        );
        if (char) {
          this.setData({ writeCharacteristicId: char.uuid, serviceId });
        } else {
          wx.showToast({ title: "特征值未找到", icon: "none" });
        }
      }
    });
  },

  disconnectDevice() {
    if (!this.data.isConnected) return;
    wx.closeBLEConnection({
      deviceId: this.data.connectedDeviceId,
      success: () => {
        this.setData({
          connectStatus: "未连接",
          isConnected: false,
          connectedDeviceId: "",
          writeCharacteristicId: ""
        });
      }
    });
  },

  // --- Core Interaction Logic (Dynamic Joystick "Zero Burden") ---

  onJoystickStart(e) {
    const side = e.currentTarget.dataset.side;
    if (this.activeTouches[side] !== null) return; // Prevent multi-touch on same side if already active

    const touch = e.changedTouches[0];
    
    // 使用新版 API 获取窗口信息以消除警告，兼容旧版
    let windowHeight;
    try {
        const info = wx.getWindowInfo();
        windowHeight = info.windowHeight;
    } catch (error) {
        // Fallback for older library versions
        const info = wx.getSystemInfoSync();
        windowHeight = info.windowHeight;
    }
    
    // Joystick size is 20vh.
    const joySizePixels = windowHeight * 0.20; 

    // Center the joystick visually on the finger
    const left = touch.pageX - joySizePixels / 2;
    const top = touch.pageY - joySizePixels / 2;

    const posKey = side === "left" ? "leftPos" : "rightPos";
    const visKey = side === "left" ? "leftVis" : "rightVis";

    this.setData({
      [visKey]: true,
      [posKey]: { left, top }
    });

    // Record the "Zero point" rect for calculation
    this.padRect[side] = {
      centerX: touch.pageX,
      centerY: touch.pageY,
      maxRadius: joySizePixels * 0.4 // 20vh total, inner is ~8vh, so movement radius is around there. Let's use 40% of box size as max reach.
    };

    this.activeTouches[side] = touch.identifier;
    this.updateJoystick(side, touch);
  },

  onJoystickMove(e) {
    const side = e.currentTarget.dataset.side;
    const id = this.activeTouches[side];
    if (id === null) return;

    const touch = Array.from(e.changedTouches).find(t => t.identifier === id);
    if (!touch) return;

    this.updateJoystick(side, touch);
  },

  onJoystickEnd(e) {
    const side = e.currentTarget.dataset.side;
    const id = this.activeTouches[side];
    if (id === null) return;
    
    const touch = Array.from(e.changedTouches).find(t => t.identifier === id);
    if (!touch) return;

    this.activeTouches[side] = null;
    this.padRect[side] = null;

    const visKey = side === "left" ? "leftVis" : "rightVis";
    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";

    this.setData({
      [visKey]: false,
      [speedKey]: 0
    });
    this.syncPacket();
  },

  updateJoystick(side, touch) {
    const rect = this.padRect[side];
    if (!rect) return;

    let dx = touch.pageX - rect.centerX;
    let dy = touch.pageY - rect.centerY; // dy is positive when going DOWN
    // We usually want Up to be positive speed, so -dy.

    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Saturation Logic: Reach 100% speed at 60% of physical travel
    // Physical travel max is rect.maxRadius
    const effectiveMaxDist = rect.maxRadius * 0.6; 
    
    let normalized = dist / effectiveMaxDist; 
    if (normalized > 1) normalized = 1;

    // Direction (only Y axis matters for tank drive speed? OR is it x/y?) 
    // The previous logic had leftStick: {x, y} but mainly sent SPEED.
    // Tank mode usually sends raw speed per track.
    // mapSpeedToByte uses leftSpeed/rightSpeed. 
    // Assuming vertical control mainly.
    // Let's preserve the standard joystick math:
    
    // Calculate vertical component ratio relative to full stick throw
    // But normalized by the "60% saturation" rule
    
    // If we only care about Y for speed:
    // val = (-dy / effectiveMaxDist) * 100
    // But we should clamp the distance first to handle circle constraints if visual stick moves?
    // The visual stick is handled by CSS or WXML? 
    // Actually current WXML might rely on us updating `leftStick` style? 
    // The previous code updated `leftStick: {x, y}` for the inner ball movement.
    
    // Visual update (inner ball) should follow finger up to maxRadius
    let visualDist = dist;
    let visualDx = dx;
    let visualDy = dy;
    
    if (visualDist > rect.maxRadius) {
       const scale = rect.maxRadius / visualDist;
       visualDx *= scale;
       visualDy *= scale;
    }
    
    // Logic update (Speed)
    // -dy because Up is negative screen coordinate
    // Saturation at 60% of maxRadius.
    let speedVal = (-dy / (rect.maxRadius * 0.6)) * 100;
    speedVal = clamp(Math.round(speedVal), -100, 100);

    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    // If using visual stick in WXML:
    // Need to set `leftStick` translation in data if WXML uses it.
    // The user's WXML had: <view class="joystick-handle" style="transform: translate({{leftStick.x}}px, {{leftStick.y}}px)"></view>
    // So distinct from speed calculation.

    // Optimize setData
    const StickKey = side === "left" ? "leftStick" : "rightStick"; // Note: WXML probably uses specific names? 
    // In previous code: `leftStick: { x: 0, y: 0 }`
    
    if (this.data[speedKey] !== speedVal) {
        this.setData({
            [speedKey]: speedVal,
            [StickKey]: { x: visualDx, y: visualDy }
        });
        this.syncPacket();
    } else {
        // Just update visual if speed didn't change (e.g. lateral movement)
        this.setData({
            [StickKey]: { x: visualDx, y: visualDy }
        });
    }
  },

  // --- Buttons ---
  
  onButtonTouchStart(e) {
    const color = e.currentTarget.dataset.color;
    this.setButton(color, 1);
  },
  
  onButtonTouchEnd(e) {
    const color = e.currentTarget.dataset.color;
    this.setButton(color, 0);
  },
  
  setButton(color, val) {
    const map = { red: 'btnRed', blue: 'btnBlue', green: 'btnGreen', yellow: 'btnYellow' };
    const key = map[color];
    if (key) {
      this.setData({ [key]: val });
      this.syncPacket();
    }
  },

  // --- Comms ---

  syncPacket() {
    // Map speed -100..100 to 0..255 (127 center)
    // 0 -> 127
    // 100 -> 255
    // -100 -> 0
    // Formula: (speed + 100) / 200 * 255 => (speed + 100) * 1.275
    const lb = Math.round((this.data.leftSpeed + 100) * 1.275);
    const rb = Math.round((this.data.rightSpeed + 100) * 1.275);
    
    const leftByte = clamp(lb, 0, 255);
    const rightByte = clamp(rb, 0, 255);

    const packet = this.createPacketData(leftByte, rightByte);
    
    // Log
    const hex = Array.from(packet).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(" ");
    const now = formatTime(new Date());
    this.setData({
      logList: [{time: now, hex}, ...this.data.logList].slice(0, 50)
    });

    this.sendData(packet);
  },

  createPacketData(l, r) {
    // Protocol:
    // B0: Left Motor
    // B1: Right Motor
    // B2..B5: Buttons (1,2,3,4 if pressed)
    // B6: XOR Check
    // B7: Tail (XOR ^ 0x55)
    
    const b0 = l;
    const b1 = r;
    const b2 = this.data.btnRed ? 0x01 : 0x00;
    const b3 = this.data.btnBlue ? 0x02 : 0x00;
    const b4 = this.data.btnGreen ? 0x03 : 0x00;
    const b5 = this.data.btnYellow ? 0x04 : 0x00;
    
    const b6 = b0 ^ b1 ^ b2 ^ b3 ^ b4 ^ b5;
    const b7 = b6 ^ 0x55;
    
    return new Uint8Array([b0, b1, b2, b3, b4, b5, b6, b7]).buffer;
  },

  sendData(buffer) {
    if (!this.data.isConnected || !this.data.writeCharacteristicId) return;
    wx.writeBLECharacteristicValue({
      deviceId: this.data.connectedDeviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.writeCharacteristicId,
      value: buffer,
      fail: (err) => {
         // console.error(err);
      }
    });
  },

  // --- UI Helpers ---

  toggleLogs() {
    this.setData({ showLogs: !this.data.showLogs });
  },
  
  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
  },
  
  closeSettings() {
    this.setData({ showSettings: false });
  },
  
  setFontSize(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ fontSizeMode: mode });
    wx.setStorageSync('fontSizeMode', mode);
  },
  
  toggleAutoClear(e) {
    this.setData({ 'settings.autoClearLog': e.detail.value });
    if (e.detail.value) {
        this.setData({ logList: [] });
    }
  },
  
  toggleAutoReconnect(e) {
    this.setData({ 'settings.autoReconnect': e.detail.value });
  },

  stopProp() {}
});
