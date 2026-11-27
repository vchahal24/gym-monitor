#pragma once
#include <Arduino.h>

// Digi Zigbee API 1, short local AT and transmit frames.
class Radio {
public:
    explicit Radio(HardwareSerial &serial) : uart(serial) {}
    bool begin();
    void send(const char *message, uint8_t id);
    int delivery(uint8_t &id);
private:
    HardwareSerial &uart;
    uint8_t buffer[128]{};
    uint16_t used = 0, length = 0;
    uint8_t stage = 0, sum = 0;
    bool escaped = false, escapeNext = false;
    bool frame();
    void writeFrame(const uint8_t *data, size_t count);
    int at(const char *cmd, const uint8_t *value = nullptr, size_t count = 0, bool queue = false);
    bool toApi();
    bool configure();
};
