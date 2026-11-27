#pragma once
#include <cmath>
#include <cstdint>

enum class State { Available, Active, Resting };

inline const char *stateName(State state) {
    switch (state) {
        case State::Active: return "ACTIVE";
        case State::Resting: return "RESTING";
        default: return "AVAILABLE";
    }
}

struct Acceleration { float x, y, z; };

class Motion {
public:
    static constexpr float thresholdG = 0.10f;
    static constexpr uint32_t restTimeoutMs = 3000;

    State update(Acceleration sample, uint32_t now) {
        if (!initialized) {
            gravity = sample;
            initialized = true;
        }
        const float x = sample.x - gravity.x, y = sample.y - gravity.y, z = sample.z - gravity.z;
        dynamicG = std::sqrt(x*x + y*y + z*z);
        // A slow gravity estimate follows changes in orientation. Sample at 50 Hz.
        gravity.x += 0.025f*x;
        gravity.y += 0.025f*y;
        gravity.z += 0.025f*z;
        if (dynamicG >= thresholdG) {
            if (consecutive < 4) ++consecutive;
            if (consecutive == 4) {
                lastMotion = now;
                state = State::Active;
            }
        } else {
            consecutive = 0;
        }
        if (state != State::Available && now - lastMotion >= restTimeoutMs) state = State::Available;
        else if (state == State::Active && now - lastMotion >= 400) state = State::Resting;
        return state;
    }

    State state = State::Available;
    float dynamicG = 0;
private:
    bool initialized = false;
    Acceleration gravity{};
    unsigned consecutive = 0;
    uint32_t lastMotion = 0;
};
