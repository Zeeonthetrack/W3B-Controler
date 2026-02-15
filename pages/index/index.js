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

    // --- 新增交互逻辑数据 ---
    leftVis: false,
    leftPos: { top: 0, left: 0 },
    rightVis: false,
    rightPos: { top: 0, left: 0 },
    showLogs: false,
    
    // --- 新增设置数据 ---
    fontSizeMode: "mode-m", // 默认中号字号: mode-s, mode-m, mode-l
    showSettings: false, 
    settings: {
      autoClearLog: false,
      autoReconnect: false
    }
  },

  padRect: { left: null, right: null },
  // 使用 touch.identifier 绑定左右手指，避免串位
  activeTouches: { left: null, right: null },

  onLoad() {
    // --- 新增: 读取字号配置 ---
    const savedMode = wx.getStorageSync('fontSizeMode');
    if (savedMode) {
      this.setData({ fontSizeMode: savedMode });
    }
    this.initBluetooth();
  },

  onReady() {
    this.measurePads();
  },

  onUnload() {
    this.disconnectDevice();
    wx.closeBluetoothAdapter();
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
      this.padRect.left = res[0] || null;
      this.padRect.right = res[1] || null;
    });
  },

  onJoystickStart(e) {
    const side = e.currentTarget.dataset.side;
    const touch = e.changedTouches[0];
    
    const sys = wx.getSystemInfoSync();
    const joySize = sys.windowHeight * 0.20; 
    
    const stickPosKey = side === "left" ? "leftPos" : "rightPos";
    const visKey = side === "left" ? "leftVis" : "rightVis";

    this.setData({
      [visKey]: true,
      [stickPosKey]: { 
        left: touch.pageX - joySize / 2, 
        top: touch.pageY - joySize / 2 
      }
    });

    this.padRect[side] = {
      left: touch.pageX - joySize / 2,
      top: touch.pageY - joySize / 2,
      width: joySize,
      height: joySize
    };

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
// --- 重构: 60% 行程满速 --- 
    // 原公式: value = (-dy / maxRadius) * 100
    // 新公式: 分母乘 0.6
    const value = Math.round((-dy / (maxRadius * 0.6)
    this.activeTouches[side] = null;
    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    const stickKey = side === "left" ? "leftStick" : "rightStick";

    this.setData({
      [speedKey]: 0,
      [stickKey]: { x: 0, y: 0 }
    });
    this.syncBytesAndSend();
  },

    this.activeTouches[side] = null;
    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    const stickKey = side === "left" ? "leftStick" : "rightStick";
    const visKey = side === "left" ? "leftVis" : "rightVis";

    this.setData({
      [visKey]: false,s = rect.width / 2 - stickRadius;

    let dx = touch.pageX - centerX;
    let dy = touch.pageY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      const scale = maxRadius / distance;
      dx *= scale;
      dy *= scale;
    }

    // 竖直方向严格线性映射：最下 -100，最上 +100
    const value = Math.round((-dy / maxRadius) * 100);
    const speed = this.clamp(value, (maxRadius * 0.6));

    const speedKey = side === "left" ? "leftSpeed" : "rightSpeed";
    const stickKey = side === "left" ? "leftStick" : "rightStick";

    if (Math.abs(speed - this.data[speedKey]) < 3) {
      this.setData({
        [stickKey]: { x: dx, y: dy }
      });
      return;
    }

    this.setData({
      [speedKey]: speed,
      [stickKey]: { x: dx, y: dy }
    });
    this.syncBytesAndSend();
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
    this.syncBytesAndSend();
  },

  syncBytesAndSend() {
    const leftByte = this.mapSpeedToByte(this.data.leftSpeed);
    const rightByte = this.mapSpeedToByte(this.data.rightSpeed);
    this.setData({ leftByte, rightByte });

    const packet = this.buildPacket(leftByte, rightByte);
    this.appendLog(packet);
    this.writePacket(packet);
  },

  mapSpeedToByte(speed) {
    // 线性映射：B = (V + 100) * 1.275，四舍五入取整
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
    // XOR 校验字节
    const b6 = b0 ^ b1 ^ b2 ^ b3 ^ b4 ^ b5;
    const b7 = b6 ^ 0x55;

    return new Uint8Array([b0, b1, b2, b3, b4, b5, b6, b7]);
  },

  writePacket(packet) {
    if (!this.data.isConnected || !this.data.writeCharacteristicId) return;

    wx.writeBLECharacteristicValue({
      deviceId: this.data.connectedDeviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.writeCharacteristicId,
      value: packet.buffer,
      fail: () => {
        wx.showToast({ title: "发送失败", icon: "none" });
      }
    });
  },

  appendLog(packet) {
    const hex = Array.from(packet)
      .map((v) => v.toString(16).padStart(2, "0"))
      .join(" ")
      .toUpperCase();
    const time = this.formatTime(new Date());
    const next = [{ time, hex }, ...this.data.logList];
    this.setData({ logList: next.slice(0, 100) });
  },

  clearLog() {
    this.setData({ logList: [] });
  },

  formatTime(date) {
    consLogs() {
    thist pad = (num) => num.toString().padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  /* --- 新增设置面板方法 (不影响核心逻辑) --- */
  toggleLogs() {
    this.setData({ showLogs: !this.data.showLogs });
  },

    this.setData({ showSettings: !this.data.showSettings });
  },

  closeSettings() {
    this.setData({ showSettings: false });
  },

  stopProp() {
    // 阻止点击冒泡
  },

  toggleAutoClear(e) {
    this.setData({ 'settings.autoClearLog': e.detail.value });
  },

  // --- 新增: 切换字号方法 ---
  setFontSize(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ fontSizeMode: mode });
    wx.setStorageSync('fontSizeMode', mode);
  },

  toggleAutoReconnect(e) {
    this.setData({ 'settings.autoReconnect': e.detail.value });
  },

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
});