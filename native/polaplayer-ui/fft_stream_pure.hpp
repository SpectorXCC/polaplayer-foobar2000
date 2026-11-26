#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace pola::fft {

class FftBandAnalyzer {
public:
    static constexpr std::size_t BandCount = 72;
    static constexpr double F0Hz = 32.0;
    static constexpr double MaxTopHz = 16000.0;
    static constexpr double TiltHz = 250.0;
    static constexpr double TiltExp = 0.42;
    static constexpr double DbFloor = -52.0;
    static constexpr double DbCeil = 0.0;
    static constexpr double AttackRate = 29.0;
    static constexpr double ReleaseRate = 4.5;

    FftBandAnalyzer() { reset(); }

    void reset() {
        bands_.fill(0.0f);
        bass_ = 0.0f;
        wasIdle_ = true;
    }

    std::array<float, BandCount> const& bands() const { return bands_; }
    float bass() const { return bass_; }
    bool isIdle() const { return wasIdle_; }

    bool stepDecay(double dtSec) {
        dtSec = std::clamp(dtSec, 0.001, 0.1);
        const float mul = static_cast<float>(std::exp(-ReleaseRate * dtSec));
        bool any = false;
        for (std::size_t i = 0; i < BandCount; ++i) {
            bands_[i] *= mul;
            if (bands_[i] < 0.0008f) bands_[i] = 0.0f;
            else any = true;
        }
        recomputeBass();
        const bool shouldEmit = any || !wasIdle_;
        wasIdle_ = !any;
        return shouldEmit;
    }

    template <typename Sample>
    bool stepSpectrumBins(
        Sample const* interleaved,
        std::size_t binCount,
        std::size_t channels,
        unsigned sampleRate,
        double dtSec) {
        if (!interleaved || binCount < 16 || channels == 0) return stepDecay(dtSec);
        dtSec = std::clamp(dtSec, 0.001, 0.1);
        const double sr = sampleRate >= 8000 ? static_cast<double>(sampleRate) : 44100.0;
        const std::size_t fftSize = binCount * 2;
        ensureBands(sr, fftSize, binCount);

        const float atkAlpha = static_cast<float>(1.0 - std::exp(-AttackRate * dtSec));
        const float relAlpha = static_cast<float>(1.0 - std::exp(-ReleaseRate * dtSec));
        bool any = false;

        for (std::size_t i = 0; i < BandCount; ++i) {
            double peak = 0.0;
            const std::size_t kStart = b0_[i];
            const std::size_t kEnd = b1_[i];
            for (std::size_t k = kStart; k < kEnd && k < binCount; ++k) {
                double chSum = 0.0;
                const std::size_t base = k * channels;
                for (std::size_t c = 0; c < channels; ++c) {
                    const double v = static_cast<double>(interleaved[base + c]);
                    chSum += v < 0.0 ? -v : v;
                }
                const double avg = chSum / static_cast<double>(channels);
                if (avg > peak) peak = avg;
            }

            const double scaled = peak * tilt_[i];
            const double db = 20.0 * std::log10(scaled + 1e-9);
            const double norm = (db - DbFloor) / (DbCeil - DbFloor);
            const float target = static_cast<float>(std::clamp(norm, 0.0, 1.0));

            const float cur = bands_[i];
            const float alpha = (target > cur) ? atkAlpha : relAlpha;
            float next = cur + (target - cur) * alpha;
            if (next < 0.0008f && target <= 0.0f) next = 0.0f;
            if (next > 0.0f) any = true;
            bands_[i] = next;
        }

        recomputeBass();
        wasIdle_ = !any;
        return true;
    }

private:
    std::array<float, BandCount> bands_{};
    float bass_ = 0.0f;
    bool wasIdle_ = true;

    double cachedSr_ = 0.0;
    std::size_t cachedFft_ = 0;
    std::array<std::size_t, BandCount> b0_{};
    std::array<std::size_t, BandCount> b1_{};
    std::array<double, BandCount> tilt_{};

    void ensureBands(double sr, std::size_t fftSize, std::size_t halfBins) {
        if (cachedSr_ == sr && cachedFft_ == fftSize) return;
        cachedSr_ = sr;
        cachedFft_ = fftSize;
        const double hzPerBin = sr / static_cast<double>(fftSize);
        const double top = std::min(MaxTopHz, sr * 0.45);
        for (std::size_t i = 0; i < BandCount; ++i) {
            const double fa = F0Hz * std::pow(top / F0Hz, static_cast<double>(i) / BandCount);
            const double fz = F0Hz * std::pow(top / F0Hz, static_cast<double>(i + 1) / BandCount);
            std::size_t k0 = static_cast<std::size_t>(std::max<long long>(1, std::llround(fa / hzPerBin)));
            std::size_t k1 = static_cast<std::size_t>(std::max<long long>(static_cast<long long>(k0) + 1, std::llround(fz / hzPerBin)));
            if (k0 >= halfBins) k0 = halfBins - 1;
            if (k1 > halfBins) k1 = halfBins;
            const double g = std::pow(std::sqrt(fa * fz) / TiltHz, TiltExp);
            b0_[i] = k0;
            b1_[i] = k1;
            tilt_[i] = std::clamp(g, 0.45, 5.0);
        }
    }

    void recomputeBass() {
        // Cover ~32 Hz to ~180 Hz (first ~20 log-spaced bands out of 72)
        // combining peak and mean so kick/bass notes drive the pulse halo clearly.
        float sum = 0.0f;
        float peak = 0.0f;
        constexpr std::size_t kBassBands = 20;
        for (std::size_t i = 0; i < kBassBands; ++i) {
            sum += bands_[i];
            if (bands_[i] > peak) peak = bands_[i];
        }
        const float mean = sum / static_cast<float>(kBassBands);
        bass_ = std::clamp(peak * 0.65f + mean * 0.35f, 0.0f, 1.0f);
    }
};

} // namespace pola::fft
