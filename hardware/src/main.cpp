#include <Arduino.h>
#include <Wire.h>
#include <esp_system.h>
#include <atomic>
#include "motion.h"
#include "radio.h"

namespace {
constexpr uint32_t sampleMs = 20, heartbeatMs = 5000, retryMs = 900;
Radio radio(Serial2);
Motion motion;
uint8_t sensorAddress = 0, lastFrame = 0;
uint32_t bootId, revision = 0, lastSample, lastSensorTry, lastTx;
char machine[13], state[16] = "SENSOR_ERROR";
std::atomic<bool> radioReady{false};
bool dirty = true, retry = false;
unsigned failedReads = 0;

bool readRegisters(uint8_t addr, uint8_t reg, uint8_t *dest, uint8_t count) {
    Wire.beginTransmission(addr); Wire.write(reg);
    if (Wire.endTransmission(false) || Wire.requestFrom(addr,count) != count) return false;
    for (uint8_t i=0; i<count; ++i) dest[i] = Wire.read();
    return true;
}

bool writeRegister(uint8_t addr, uint8_t reg, uint8_t value) {
    Wire.beginTransmission(addr); Wire.write(reg); Wire.write(value);
    return Wire.endTransmission() == 0;
}

bool openSensor() {
    for (uint8_t addr : {uint8_t(0x68),uint8_t(0x69)}) {
        uint8_t id;
        if (!readRegisters(addr,0x75,&id,1) || (id != 0x68 && id != 0x98)) continue;
        // Both installed IMUs use these registers and 16384 counts/g at +/-2 g.
        if (!writeRegister(addr,0x6b,0x01) || !writeRegister(addr,0x1c,0x00)) continue;
        delay(40);
        sensorAddress = addr; failedReads = 0; motion = Motion{};
        Serial.printf("Accelerometer I2C 0x%02x WHO_AM_I 0x%02x\n",addr,id);
        return true;
    }
    return false;
}

void setState(const char *next) {
    if (strcmp(state,next) == 0) return;
    snprintf(state,sizeof(state),"%s",next);
    ++revision; dirty = true;
    Serial.printf("State %s (dynamic %.3f g)\n",state,motion.dynamicG);
}

void sample(uint32_t now) {
    uint8_t bytes[6];
    if (!readRegisters(sensorAddress,0x3b,bytes,sizeof(bytes))) {
        if (++failedReads >= 5) { sensorAddress = 0; setState("SENSOR_ERROR"); }
        return;
    }
    failedReads = 0;
    auto axis = [&](unsigned i) { return int16_t((uint16_t(bytes[i])<<8)|bytes[i+1]) / 16384.0f; };
    setState(stateName(motion.update({axis(0),axis(2),axis(4)},now)));
}

void connectRadio(void *) {
    while (!radio.begin()) {
        Serial.println("XBee unavailable on GPIO16/17");
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
    Serial.println("Router ready");
    radioReady.store(true);
    vTaskDelete(nullptr);
}

void transmit(uint32_t now) {
    char message[96];
    snprintf(message,sizeof(message),"GT1,%s,%08lx,%lu,%s,%u",machine,
        (unsigned long)bootId,(unsigned long)revision,state,(unsigned)lroundf(1000*motion.dynamicG));
    if (++lastFrame == 0) ++lastFrame;
    radio.send(message,lastFrame);
    dirty = false; retry = false; lastTx = now;
}
}

void setup() {
    Serial.begin(115200);
    uint8_t mac[6]; esp_efuse_mac_get_default(mac);
    snprintf(machine,sizeof(machine),"%02x%02x%02x%02x%02x%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
    bootId = esp_random();
    Serial.printf("\nGymTracker %s\n",machine);
    Wire.begin(21,22,100000); Wire.setTimeOut(30);
    openSensor();
    if (sensorAddress) sample(millis());
    if (xTaskCreate(connectRadio,"XBee setup",4096,nullptr,1,nullptr) != pdPASS) {
        Serial.println("Unable to start XBee setup; rebooting");
        ESP.restart();
    }
}

void loop() {
    uint32_t now = millis();
    if (!sensorAddress && now-lastSensorTry >= 1500) { lastSensorTry=now; openSensor(); }
    if (sensorAddress && now-lastSample >= sampleMs) { lastSample=now; sample(now); }
    if (radioReady.load()) {
        uint8_t id;
        int status;
        while ((status=radio.delivery(id)) >= 0) {
            if (status && id == lastFrame) {
                retry = true;
                Serial.printf("XBee delivery status 0x%02x\n",status);
            }
        }
        if (dirty || (retry && now-lastTx >= retryMs) || now-lastTx >= heartbeatMs) transmit(now);
    }
    delay(1);
}
