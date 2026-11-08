#include <Wire.h>

#define SDA_PIN 21
#define SCL_PIN 22

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  Serial.println("ESP32 I2C Scanner");
}

void loop() {
  int devicesFound = 0;

  Serial.println("Scanning I2C bus...");

  for (uint8_t address = 0x08; address <= 0x77; address++) {
    Wire.beginTransmission(address);

    if (Wire.endTransmission() == 0) {
      Serial.print("Device found at 0x");

      if (address < 0x10) {
        Serial.print("0");
      }

      Serial.println(address, HEX);
      devicesFound++;
    }
  }

  if (devicesFound == 0) {
    Serial.println("No I2C devices founded.");
  }

  Serial.println();
  delay(2000);
}

