#include <Wire.h>
#include <math.h>

constexpr uint8_t I2C_ADDR = 0x68;
constexpr int SDA_PIN = 21;
constexpr int SCL_PIN = 22;

// writing a value to a register in the I2C address of the accelerometer
bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readAcceleration(float &ax, float &ay, float &az) {
  Wire.beginTransmission(I2C_ADDR);
  Wire.write(0x3B); // First register in a GY 521 accelerometer
  
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  // if 6 bytes are not returned, then false because we need 2 bytes from X, 2 from Y, 2 from Z
  if (Wire.requestFrom(I2C_ADDR, (uint8_t)6) != 6) {
    return false;
  }

  // we need 16 bit signed values for each but only 8 is transmitted at a time, so we OR them to combine 8 and 8
  // then we shift it to the left by 8 to get Y values and do the same for Z
  int16_t rawX = (Wire.read() << 8) | Wire.read();
  int16_t rawY = (Wire.read() << 8) | Wire.read();
  int16_t rawZ = (Wire.read() << 8) | Wire.read();

  // the values are raw and need to be converted into G, so we divide by 2^14
  ax = rawX / 16384.0f;
  ay = rawY / 16384.0f;
  az = rawZ / 16384.0f;

  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  // Wake up
  if (!writeReg(0x6B, 0x00)) {
    Serial.println("Failed to wake up GY 521");
    while (true) delay(1000);
  }

  // set accelerometer range to +/- 2g
  if (!writeReg(0x1C, 0x00)) {
    Serial.println("Failed to configure accelerometer");
    while (true) delay(1000);
  }

  delay(100);
  Serial.println("GY 521 initialized");
}

void loop() {
  float ax, ay, az;

  if (readAcceleration(ax, ay, az)) {
    float magnitude = sqrtf(
          ax * ax + ay * ay + az * az
        );

    Serial.print("X: ");
    Serial.print(ax, 3);

    Serial.print(" | Y: ");
    Serial.print(ay, 3);

    Serial.print(" | Z: ");
    Serial.print(az, 3);

    Serial.print(" | Magnitude: ");
    Serial.println(magnitude, 3);
  } else {
    Serial.println("Sensor reading failed");
  }
  
  delay(100);
}

