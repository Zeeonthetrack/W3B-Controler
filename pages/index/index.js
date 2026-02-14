// index.js
Page({
  data: {
    connectStatus: "未连接",
    isSearching: false,
    isConnected: false,
    deviceList: [],
    connectedDeviceId: "",
    writeCharacteristicId: "",
    serviceId: "0000FFE0-0000-1000-8000-00805F9B34FB", // 通用BLE串口服务UUID
    characteristicId: "0000FFE1-0000-1000-8000-00805F9B34FB", // 通用可写特征值UUID
    filterDeviceName: "MySTM32Car" // 你的蓝牙模块名字
  },

  // 页面加载时初始化蓝牙
  onLoad() {
    this.initBluetooth();
  },

  // 初始化蓝牙适配器
  initBluetooth() {
    wx.openBluetoothAdapter({
      success: () => {
        console.log("蓝牙适配器初始化成功");
        // 监听蓝牙状态变化
        wx.onBluetoothAdapterStateChange((res) => {
          if (!res.available) {
            this.setData({
              connectStatus: "蓝牙已关闭",
              isConnected: false
            });
            wx.showToast({
              title: "请开启手机蓝牙",
              icon: "none"
            });
          }
        });
      },
      fail: (err) => {
        console.log("蓝牙初始化失败", err);
        wx.showToast({
          title: "蓝牙初始化失败，请开启蓝牙",
          icon: "none"
        });
      }
    });
  },

  // 开始搜索蓝牙设备
  startSearch() {
    if (this.data.isSearching) return;

    // 清空之前的设备列表
    this.setData({
      deviceList: [],
      isSearching: true
    });

    // 开始搜索
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false, // 不重复显示同一设备
      success: () => {
        console.log("开始搜索设备");
        wx.showToast({
          title: "正在搜索设备...",
          icon: "loading"
        });

        // 监听发现新设备
        wx.onBluetoothDeviceFound((res) => {
          res.devices.forEach(device => {
            // 只显示有名字、且名字匹配的设备
            if (!device.name || device.name.indexOf(this.data.filterDeviceName) === -1) return;

            // 去重，避免重复添加
            const list = this.data.deviceList;
            const isExist = list.some(item => item.deviceId === device.deviceId);
            if (!isExist) {
              list.push(device);
              this.setData({
                deviceList: list
              });
            }
          });
        });

        // 10秒后自动停止搜索
        setTimeout(() => {
          this.stopSearch();
        }, 10000);
      },
      fail: (err) => {
        console.log("搜索设备失败", err);
        this.setData({
          isSearching: false
        });
        wx.showToast({
          title: "搜索失败，请检查权限",
          icon: "none"
        });
      }
    });
  },

  // 停止搜索设备
  stopSearch() {
    wx.stopBluetoothDevicesDiscovery({
      success: () => {
        console.log("停止搜索");
        this.setData({
          isSearching: false
        });
      }
    });
  },

  // 连接选中的设备
  connectDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    if (this.data.isConnected) return;

    wx.showLoading({
      title: "正在连接..."
    });

    // 停止搜索
    this.stopSearch();

    // 建立BLE连接
    wx.createBLEConnection({
      deviceId: deviceId,
      success: () => {
        console.log("设备连接成功");
        this.setData({
          connectedDeviceId: deviceId,
          connectStatus: "已连接",
          isConnected: true
        });
        wx.hideLoading();
        wx.showToast({
          title: "连接成功"
        });

        // 连接成功后，获取服务和特征值
        setTimeout(() => {
          this.getDeviceService(deviceId);
        }, 1000);

        // 监听连接断开
        wx.onBLEConnectionStateChange((res) => {
          if (!res.connected) {
            console.log("连接已断开");
            this.setData({
              connectStatus: "连接已断开",
              isConnected: false,
              connectedDeviceId: "",
              writeCharacteristicId: ""
            });
            wx.showToast({
              title: "连接已断开",
              icon: "none"
            });
          }
        });
      },
      fail: (err) => {
        console.log("连接失败", err);
        wx.hideLoading();
        wx.showToast({
          title: "连接失败",
          icon: "none"
        });
      }
    });
  },

  // 获取设备的服务和特征值
  getDeviceService(deviceId) {
    wx.getBLEDeviceServices({
      deviceId: deviceId,
      success: (res) => {
        console.log("获取设备服务成功", res);
        // 找到我们需要的服务
        const service = res.services.find(item => item.uuid.toUpperCase() === this.data.serviceId.toUpperCase());
        if (!service) {
          wx.showToast({
            title: "未找到匹配的服务",
            icon: "none"
          });
          return;
        }

        // 获取特征值
        this.getDeviceCharacteristic(deviceId, service.uuid);
      },
      fail: (err) => {
        console.log("获取服务失败", err);
      }
    });
  },

  // 获取特征值
  getDeviceCharacteristic(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId: deviceId,
      serviceId: serviceId,
      success: (res) => {
        console.log("获取特征值成功", res);
        // 找到可写的特征值
        const characteristic = res.characteristics.find(item => item.uuid.toUpperCase() === this.data.characteristicId.toUpperCase());
        if (!characteristic || !characteristic.properties.write) {
          wx.showToast({
            title: "未找到可写特征值",
            icon: "none"
          });
          return;
        }

        this.setData({
          writeCharacteristicId: characteristic.uuid,
          serviceId: serviceId
        });
      },
      fail: (err) => {
        console.log("获取特征值失败", err);
      }
    });
  },

  // 发送指令给小车
  sendCommand(e) {
    const command = e.currentTarget.dataset.command;
    if (!this.data.isConnected) {
      wx.showToast({
        title: "请先连接设备",
        icon: "none"
      });
      return;
    }

    // 把16进制指令转成ArrayBuffer格式（微信BLE必须用这个格式）
    const buffer = new Uint8Array([parseInt(command)]).buffer;

    // 写入特征值
    wx.writeBLECharacteristicValue({
      deviceId: this.data.connectedDeviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.writeCharacteristicId,
      value: buffer,
      success: () => {
        console.log("指令发送成功", command);
      },
      fail: (err) => {
        console.log("指令发送失败", err);
        wx.showToast({
          title: "指令发送失败",
          icon: "none"
        });
      }
    });
  },

  // 断开设备连接
  disconnectDevice() {
    if (!this.data.isConnected) return;

    wx.closeBLEConnection({
      deviceId: this.data.connectedDeviceId,
      success: () => {
        console.log("断开连接成功");
        this.setData({
          connectStatus: "未连接",
          isConnected: false,
          connectedDeviceId: "",
          writeCharacteristicId: ""
        });
        wx.showToast({
          title: "已断开连接"
        });
      }
    });
  },

  // 页面卸载时断开连接
  onUnload() {
    this.disconnectDevice();
    wx.closeBluetoothAdapter();
  }
});