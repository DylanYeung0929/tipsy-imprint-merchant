#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <NimBLEDevice.h>
#include <math.h>

// 必须与电脑端 ble_bridge.py 中的 UUID 一致
const char* DEVICE_NAME = "CupSensor-C6";
const char* SERVICE_UUID = "6d374100-6b8f-4f0e-8b3a-3a25d74c2100";
const char* DATA_UUID    = "6d374101-6b8f-4f0e-8b3a-3a25d74c2100";

const uint8_t FSR_PIN = D1;
const uint32_t SAMPLE_INTERVAL_MS = 40;  // 25 Hz

Adafruit_MPU6050 mpu;
NimBLEServer* bleServer = nullptr;
NimBLECharacteristic* dataCharacteristic = nullptr;

uint16_t sampleNo = 0;
uint32_t nextSampleMs = 0;
uint32_t lastPrintMs = 0;
bool wasConnected = false;

// 一组样本正好20字节，适配默认BLE通知长度
struct __attribute__((packed)) BleSample {
  uint16_t sampleNo;
  uint32_t uptimeMs;
  uint16_t fsrAdc;
  int16_t ax;
  int16_t ay;
  int16_t az;
  int16_t gx;
  int16_t gy;
  int16_t gz;
};

static_assert(sizeof(BleSample) == 20, "BLE packet must be 20 bytes");

int16_t encodeValue(float value, float scale) {
  long result = lroundf(value * scale);
  if (result > 32767) result = 32767;
  if (result < -32768) result = -32768;
  return static_cast<int16_t>(result);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  // 沿用原来的MPU6050接线：D4=SDA，D5=SCL
  Wire.begin(D4, D5);
  Wire.setClock(400000);

  if (!mpu.begin(0x68, &Wire)) {
    Serial.println("MPU6050 not found. Check D4/D5, power and GND.");
    while (true) {
      delay(1000);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  analogReadResolution(12);
  analogSetPinAttenuation(FSR_PIN, ADC_11db);

  NimBLEDevice::init(DEVICE_NAME);

  bleServer = NimBLEDevice::createServer();
  NimBLEService* service = bleServer->createService(SERVICE_UUID);

  dataCharacteristic = service->createCharacteristic(
    DATA_UUID,
    NIMBLE_PROPERTY::NOTIFY
  );

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setName(DEVICE_NAME);
  advertising->start();

  nextSampleMs = millis();

  Serial.println("ESP32C6 BLE sensor ready.");
  Serial.println("BLE name: CupSensor-C6");
  Serial.println("FSR: D1; MPU6050 SDA: D4, SCL: D5");
}

void loop() {
  bool connected = bleServer->getConnectedCount() > 0;

  if (connected != wasConnected) {
    if (connected) {
      Serial.println("BLE connected.");
    } else {
      Serial.println("BLE disconnected; advertising again.");
      NimBLEDevice::getAdvertising()->start();
    }
    wasConnected = connected;
  }

  uint32_t now = millis();

  if (static_cast<int32_t>(now - nextSampleMs) < 0) {
    delay(1);
    return;
  }

  nextSampleMs += SAMPLE_INTERVAL_MS;

  // 读取延迟时不快速补采，以免伪造25Hz数据
  if (static_cast<int32_t>(now - nextSampleMs) > 40) {
    nextSampleMs = now + SAMPLE_INTERVAL_MS;
  }

  sensors_event_t acceleration, gyro, temperature;
  mpu.getEvent(&acceleration, &gyro, &temperature);

  BleSample packet;
  packet.sampleNo = sampleNo++;
  packet.uptimeMs = now;

  // D1的原始ADC读数，不在这里反转或放大
  packet.fsrAdc = analogRead(FSR_PIN);

  // 加速度：m/s²，放大100倍编码
  packet.ax = encodeValue(acceleration.acceleration.x, 100.0f);
  packet.ay = encodeValue(acceleration.acceleration.y, 100.0f);
  packet.az = encodeValue(acceleration.acceleration.z, 100.0f);

  // 角速度：由rad/s转为deg/s，放大10倍编码
  packet.gx = encodeValue(gyro.gyro.x * RAD_TO_DEG, 10.0f);
  packet.gy = encodeValue(gyro.gyro.y * RAD_TO_DEG, 10.0f);
  packet.gz = encodeValue(gyro.gyro.z * RAD_TO_DEG, 10.0f);

  if (connected) {
    dataCharacteristic->setValue(
      reinterpret_cast<const uint8_t*>(&packet),
      sizeof(packet)
    );
    dataCharacteristic->notify();
  }

  if (now - lastPrintMs >= 1000) {
    lastPrintMs = now;

    Serial.printf(
      "BLE:%s FSR:%u Ax:%.2f Ay:%.2f Az:%.2f "
      "Gx:%.1f Gy:%.1f Gz:%.1f\n",
      connected ? "connected" : "waiting",
      packet.fsrAdc,
      acceleration.acceleration.x,
      acceleration.acceleration.y,
      acceleration.acceleration.z,
      gyro.gyro.x * RAD_TO_DEG,
      gyro.gyro.y * RAD_TO_DEG,
      gyro.gyro.z * RAD_TO_DEG
    );
  }
}