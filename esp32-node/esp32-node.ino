void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("ESP32 initialized!");
}

void loop() {
  Serial.println("Hello from Neovim!");
  delay(1000);
}
