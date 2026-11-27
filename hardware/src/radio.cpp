#include "radio.h"
#include <cstring>

namespace {
constexpr uint32_t pan = 0x47594d31;  // ASCII GYM1
constexpr uint8_t panBytes[] = {0,0,0,0,0x47,0x59,0x4d,0x31};
}

bool Radio::frame() {
    while (uart.available()) {
        uint8_t b = uart.read();
        if (stage == 0) {
            if (b == 0x7e) { stage = 1; escapeNext = false; }
            continue;
        }
        if (escaped) {
            if (escapeNext) { b ^= 0x20; escapeNext = false; }
            else if (b == 0x7d) { escapeNext = true; continue; }
            else if (b == 0x7e) { stage = 1; continue; }
        }
        switch (stage) {
            case 1: length = uint16_t(b) << 8; stage = 2; break;
            case 2:
                length |= b; used = 0; sum = 0;
                stage = length && length <= sizeof(buffer) ? 3 : 0; break;
            case 3:
                buffer[used++] = b; sum += b; if (used == length) stage = 4; break;
            case 4:
                stage = 0; if (uint8_t(sum+b) == 0xff) return true; break;
        }
    }
    return false;
}

void Radio::writeFrame(const uint8_t *data, size_t count) {
    auto put = [&](uint8_t b) {
        if (escaped && (b == 0x7e || b == 0x7d || b == 0x11 || b == 0x13)) {
            uart.write(0x7d); b ^= 0x20;
        }
        uart.write(b);
    };
    uart.write(0x7e); put(count >> 8); put(count);
    uint8_t checksum = 0xff;
    for (size_t i=0; i<count; ++i) { put(data[i]); checksum -= data[i]; }
    put(checksum);
}

int Radio::at(const char *cmd, const uint8_t *value, size_t count, bool queue) {
    uint8_t request[12] = {uint8_t(queue ? 0x09 : 0x08), 1, uint8_t(cmd[0]), uint8_t(cmd[1])};
    if (count > sizeof(request)-4) return -1;
    if (count) memcpy(request+4, value, count);
    writeFrame(request, count+4);
    uint32_t start = millis();
    while (millis()-start < 500) {
        if (frame() && length >= 5 && buffer[0] == 0x88 && buffer[1] == 1 &&
            buffer[2] == cmd[0] && buffer[3] == cmd[1] && buffer[4] == 0) return length-5;
        delay(1);
    }
    return -1;
}

bool Radio::toApi() {
    // AP query and its reply have no reserved bytes in either API mode.
    escaped = false; stage = 0;
    if (at("AP") == 1) { escaped = buffer[5] == 2; return true; }
    delay(1200); while (uart.available()) uart.read();
    uart.print("+++"); uart.flush();
    uart.setTimeout(1800);
    if (uart.readStringUntil('\r') != "OK") return false;
    auto command = [&](const char *s) {
        uart.print(s); uart.write('\r'); return uart.readStringUntil('\r') == "OK";
    };
    const bool ok = command("ATAP1") && command("ATWR");
    command("ATCN"); delay(150); stage=0;
    return ok && at("AP") == 1;
}

bool Radio::configure() {
    if (at("VR") < 2) return false;
    Serial.printf("XBee VR %02x%02x\n",buffer[5],buffer[6]);
    uint8_t router = 0;
    if (at("CE") != 1) return false;
    bool roleChange = buffer[5] != router;
    // Both routers must match the coordinator's lab network security setting.
    if (at("EE") != 1) return false;
    bool encryptionChange = buffer[5] != 0;
    int bytes = at("ID");
    if (bytes < 1 || bytes > 8) return false;
    uint64_t previous = 0;
    for (int i=0; i<bytes; ++i) previous = (previous<<8) | buffer[5+i];
    if (!roleChange && !encryptionChange && previous == pan) return true;
    if (roleChange && at("CE",&router,1,true)<0) return false;
    const uint8_t encryption = 0;
    if (encryptionChange && at("EE",&encryption,1,true)<0) return false;
    if (previous != pan && at("ID",panBytes,sizeof(panBytes),true)<0) return false;
    if (at("AC") < 0) return false;
    return at("WR") >= 0;
}

bool Radio::begin() {
    for (uint32_t baud : {9600u, 115200u, 19200u, 38400u, 57600u}) {
        uart.begin(baud,SERIAL_8N1,16,17);
        if (toApi()) {
            Serial.printf("XBee UART %lu baud\n", (unsigned long)baud);
            if (!configure()) return false;
            for (const char *key : {"SH","SL","CE","ID","OP","AI","CH","SC","EE","ZS","SM"}) {
                int count=at(key);
                Serial.printf("XBee %s=",key);
                for (int i=0; i<count; ++i) Serial.printf("%02x",buffer[5+i]);
                Serial.println();
            }
            return true;
        }
        uart.end();
    }
    return false;
}

void Radio::send(const char *message, uint8_t id) {
    // 64-bit 0 is the Zigbee coordinator, FFFE requests network address discovery.
    uint8_t data[116] = {0x10,id,0,0,0,0,0,0,0,0,0xff,0xfe,0,0};
    size_t size = strlen(message);
    if (size > sizeof(data)-14) return;
    memcpy(data+14,message,size); writeFrame(data,size+14);
}

int Radio::delivery(uint8_t &id) {
    while (frame()) {
        if (length >= 7 && buffer[0] == 0x8b) { id=buffer[1]; return buffer[5]; }
    }
    return -1;
}
