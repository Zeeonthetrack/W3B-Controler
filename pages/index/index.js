const SERVICE_UUID = "0000FFE0-0000-1000-8000-00805F9B34FB";
const CHAR_UUID = "0000FFE1-0000-1000-8000-00805F9B34FB";

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

    leftStick: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    logList: [],

    showLogPanel: false,
    showSettings: false,
    settings: {
      useBinary: true,
      sendInterval: 50,
      autoClearLog: false,
      fontSize: 'medium'
    },
    tempSettings: {}, // For holding unsaved changes
    sendTimer: null,
    
    navBarHeight: 0,
    menuButtonInfo: {},
  },

  padRect: { left: null, right: null },
  activeTouches: { left: null, right: null },

  onLoad() {
    const that = this;
    
    const systemInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const navBarHeight = (menuButtonInfo.height + (menuButtonInfo.top - systemInfo.statusBarHeight) * 2) * 1.2;
    
    that.setData({
      navBarHeight: navBarHeight,
      menuButtonInfo: menuButtonInfo
    });
    
    wx.getStorage({
      key: 'userSettings',
      success (res) {
        if(res.data) that.setData({ settings: res.data });
        that.startSendLoop();
      },
      fail () {
        that.startSendLoop();
      }
    });
    this.initBluetooth();
  },

  onReady() {
    this.measurePads();
  },

  onUnload() {
    this.stopSendLoop();
    this.disconnectDevice();
    wx.closeBluetoothAdapter();
  },

  startSendLoop() {
    this.stopSendLoop();
    const interval = this.data.settings.sendInterval || 50;
    this.data.sendTimer = setInterval(() => {
      this.sendPacketTask();
    }, interval);
  },

  stopSendLoop() {
    if (this.data.sendTimer) {
      clearInterval(this.data.sendTimer);
      this.data.sendTimer = null;
    }
  },

  sendPacketTask() {
    // Always calculate bytes based on current speed
    const leftByte = this.mapSpeedToByte(this.data.leftSpeed);
    const rightByte = this.mapSpeedToByte(this.data.rightSpeed);
    
    // Build packet
    const packet = this.buildPacket(leftByte, rightByte);
    
    // Always log (if binary mode or whatever, logging logic remains)
    this.appendLog(packet);
    
    // Only write if connected
    if (this.data.isConnected) {
      this.writePacket(packet);
    }
  },

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
            wx.showToast({ title: "请开启手机蓝牙", icon: "none" });
          } else {
            this.setData({ bleAvailable: true, connectStatus: this.data.isConnected ? "已连接" : "未连接" });
          }
        });
      },
      fail: () => {
        this.setData({ bleAvailable: false, connectStatus: "蓝牙不可用" });
        wx.showToast({ title: "请开启手机蓝牙", icon: "none" });
      }
    });
  },

  checkLocationPermission() {
    const system = wx.getSystemInfoSync();
    if (system.platform !== "android") return;

    wx.getSetting({
      success: (res) => {
        if (!res.authSetting["scope.userLocation"]) {
          wx.showModal({
            title: "需要位置权限",
            content: "安卓搜索蓝牙需要开启位置权限",
            confirmText: "去开启",
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting();
              }
            }
          });
        }
      }
    });
  },

  startSearch() {
    if (this.data.isSearching) return;
    if (!this.data.bleAvailable) {
      wx.showToast({ title: "请开启手机蓝牙", icon: "none" });
      return;
    }

    this.checkLocationPermission();

    this.setData({ deviceList: [], isSearching: true });

    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => {
        wx.showToast({ title: "正在搜索设备...", icon: "loading" });
        wx.onBluetoothDeviceFound((res) => {
          res.devices.forEach((device) => {
            if (!device.name || device.name.indexOf(this.data.filterDeviceName) === -1) return;

            const list = this.data.deviceList;
            const isExist = list.some((item) => item.deviceId === device.deviceId);
            if (!isExist) {
              list.push(device);
              this.setData({ deviceList: list });
            }
          });
        });

        setTimeout(() => {
          this.stopSearch();
        }, 10000);
      },
      fail: () => {
        this.setData({ isSearching: false });
        wx.showToast({ title: "搜索失败，请检查权限", icon: "none" });
      }
    });
  },

  stopSearch() {
    wx.stopBluetoothDevicesDiscovery({
      success: () => {
        this.setData({ isSearching: false });
      }
    });
  },

  connectDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    this.connectDeviceById(deviceId);
  },

  reconnectLast() {
    if (!this.data.lastDeviceId || this.data.isConnected) return;
    this.connectDeviceById(this.data.lastDeviceId);
  },

  connectDeviceById(deviceId) {
    if (!deviceId || this.data.isConnected) return;

    wx.showLoading({ title: "正在连接..." });
    this.stopSearch();

    wx.createBLEConnection({
      deviceId,
      success: () => {
        this.setData({
          connectedDeviceId: deviceId,
          lastDeviceId: deviceId,
          connectStatus: "已连接",
          isConnected: true
        });
        wx.hideLoading();
        wx.showToast({ title: "连接成功" });

        setTimeout(() => {
          this.getDeviceService(deviceId);
        }, 500);

        wx.onBLEConnectionStateChange((res) => {
          if (!res.connected) {
            this.setData({
              connectStatus: "连接已断开",
              isConnected: false,
              connectedDeviceId: "",
              writeCharacteristicId: ""
            });
            wx.showToast({ title: "连接已断开", icon: "none" });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "连接失败，请靠近设备", icon: "none" });
      }
    });
  },

  getDeviceService(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        const service = res.services.find((item) => item.uuid.toUpperCase() === this.data.serviceId.toUpperCase());
        if (!service) {
          wx.showToast({ title: "未找到匹配服务", icon: "none" });
          return;
        }

        this.getDeviceCharacteristic(deviceId, service.uuid);
      },
      fail: () => {
        wx.showToast({ title: "获取服务失败", icon: "none" });
      }
    });
  },

  getDeviceCharacteristic(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        const characteristic = res.characteristics.find(
          (item) => item.uuid.toUpperCase() === this.data.characteristicId.toUpperCase()
        );
        if (!characteristic || !characteristic.properties.write) {
          wx.showToast({ title: "未找到可写特征值", icon: "none" });
          return;
        }

        this.setData({ writeCharacteristicId: characteristic.uuid, serviceId });
      },
      fail: () => {
        wx.showToast({ title: "获取特征值失败", icon: "none" });
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
        wx.showToast({ title: "已断开连接" });
      }
    });
  },

  measurePads() {
    const query = wx.createSelectorQuery();
    query.select("#leftPad").boundingClientRect();
    query.select("#rightPad").boundingClientRect();
    query.exec((res) => {
      if (res[0]) this.padRect.left = res[0];
      if (res[1]) this.padRect.right = res[1];
    });
  },

  onJoystickStart(e) {
    const side = e.currentTarget.dataset.side;
    if (!this.padRect[side]) return;

    const touch = e.changedTouches[0];
    this.activeTouches[side] = touch.identifier;
    this.updateJoystickByTouch(side, touch);
  },

  onJoystickMove(e) {
    const side = e.currentTarget.dataset.side;
    const activeId = this.activeTouches[side];
    if (activeId === null) return;

    const touch = this.findTouchById(e.changedTouches, activeId);
    if (!touch) return;

    this.updateJoystickByTouch(side, touch);
  },

  onJoystickEnd(e) {
    const side = e.currentTarget.dataset.side;
    const activeId = this.activeTouches[side];
    if (activeId === null) return;

    const touch = this.findTouchById(e.changedTouches, activeId);
    if (!touch) return;

    this.activeTouches[side] = null;
    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    const stickKey = side === "left" ? "leftStick" : "rightStick";

    this.setData({
      [speedKey]: 0,
      [stickKey]: { x: 0, y: 0 }
    });
  },

  updateJoystickByTouch(side, touch) {
    const rect = this.padRect[side];
    if (!rect) return;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const stickRadius = rect.width * 0.16;
    const maxRadius = rect.width / 2 - stickRadius;

    let dx = touch.pageX - centerX;
    let dy = touch.pageY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      const scale = maxRadius / distance;
      dx *= scale;
      dy *= scale;
    }

    const value = Math.round((-dy / (maxRadius * 0.6)) * 100);
    const speed = this.clamp(value, -100, 100);

    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    const stickKey = side === "left" ? "leftStick" : "rightStick";

    if (Math.abs(speed - this.data[speedKey]) < 2) {
      this.setData({
        [stickKey]: { x: dx, y: dy }
      });
      return;
    }

    this.setData({
      [speedKey]: speed,
      [stickKey]: { x: dx, y: dy }
    });
    // Removed direct send, now handled by loop
    /*this.syncBytesAndSend();*/
  },

  findTouchById(touches, id) {
    for (let i = 0; i < touches.length; i += 1) {
      if (touches[i].identifier === id) return touches[i];
    }
    return null;
  },

  onButtonTouchStart(e) {
    const color = e.currentTarget.dataset.color;
    this.updateButtonState(color, 1);
  },

  onButtonTouchEnd(e) {
    const color = e.currentTarget.dataset.color;
    this.updateButtonState(color, 0);
  },

  updateButtonState(color, pressed) {
    const map = {
      red: "btnRed",
      blue: "btnBlue",
      green: "btnGreen",
      yellow: "btnYellow"
    };
    const key = map[color];
    if (!key) return;

    this.setData({ [key]: pressed });
    // Removed direct send
    /*this.syncBytesAndSend();*/
  },

  // Helper, now called by sendLoop
  mapSpeedToByte(speed) {
    const raw = Math.round((speed + 100) * 1.275);
    return this.clamp(raw, 0, 255);
  },

  buildPacket(leftByte, rightByte) {
    const b0 = leftByte;
    const b1 = rightByte;
    const b2 = this.data.btnRed ? 1 : 0;
    const b3 = this.data.btnBlue ? 2 : 0;
    const b4 = this.data.btnGreen ? 3 : 0;
    const b5 = this.data.btnYellow ? 4 : 0;
    const b6 = b0 ^ b1 ^ b2 ^ b3 ^ b4 ^ b5;
    const b7 = b6 ^ 0x55;

    return new Uint8Array([b0, b1, b2, b3, b4, b5, b6, b7]);
  },

  writePacket(packet) {
    if (!this.data.isConnected || !this.data.writeCharacteristicId) return;

    // Use current settings (if relevant for packet format, but user kept packet format same)
    // The requirement is just binary mode switch in settings but packet structure is fixed.
    
    wx.writeBLECharacteristicValue({
      deviceId: this.data.connectedDeviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.writeCharacteristicId,
      value: packet.buffer,
      fail: (res) => {
        // console.log("Write failed", res);
      }
    });
  },


  appendLog(packet) {
    const bytes = Array.from(packet);
    const hexRaw = bytes.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    const hex = `L:${bytes[0].toString(16).padStart(2,"0").toUpperCase()} R:${bytes[1].toString(16).padStart(2,"0").toUpperCase()} A:${bytes[2]} B:${bytes[3]} C:${bytes[4]} D:${bytes[5]} X:${bytes[6].toString(16).padStart(2,"0").toUpperCase()} T:${bytes[7].toString(16).padStart(2,"0").toUpperCase()}`;
    const time = this.formatTime(new Date());
    const next = [{ time, hex, hexRaw }, ...this.data.logList];
    
    // Auto clear log check
    if (this.data.settings.autoClearLog && next.length > 50) {
       this.setData({ logList: next.slice(0, 50) });
    } else {
       this.setData({ logList: next.slice(0, 100) }); 
    }
  },

  clearLog() {
    this.setData({ logList: [] });
  },

  formatTime(date) {
    const pad = (num) => num.toString().padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  toggleLogPanel() {
    this.setData({ showLogPanel: !this.data.showLogPanel });
  },

  closeLogPanel() {
    this.setData({ showLogPanel: false });
  },

  toggleSettings() {
    // Copy current settings to temp when opening
    this.setData({ 
      showSettings: !this.data.showSettings,
      tempSettings: {...this.data.settings} 
    });
  },

  closeSettings() {
    // Discard changes
    this.setData({ showSettings: false });
  },

  stopProp() {},

  toggleAutoClear(e) {
    this.setData({ 'settings.autoClearLog': e.detail.value });
  },

  // Settings Handlers
  onSettingChange(e) {
    const field = e.currentTarget.dataset.field;
    let value = e.detail.value;
    
    if(field === 'sendInterval') {
      const parsed = parseInt(value);
      value = isNaN(parsed) ? 50 : parsed;
    }

    const temp = this.data.tempSettings;
    temp[field] = value;
    this.setData({ tempSettings: temp });
  },

  setFontSize(e) {
    const size = e.currentTarget.dataset.size;
    const temp = this.data.tempSettings;
    temp.fontSize = size;
    this.setData({ tempSettings: temp });
  },

  closeSettings() {
    this.setData({ showSettings: false });
  },

  saveSettings() {
    this.setData({
      settings: this.data.tempSettings,
      showSettings: false
    });
    
    this.startSendLoop();
    wx.setStorage({
      key: 'userSettings',
      data: this.data.settings
    });
  },

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
});
