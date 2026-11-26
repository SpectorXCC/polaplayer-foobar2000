#include "../fft_stream_pure.hpp"

#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

using namespace pola::fft;

namespace {

void testLogBandsAndResponse() {
    FftBandAnalyzer analyzer;
    assert(analyzer.isIdle());

    // Simulate 1024 FFT magnitude bins (for 2048 FFT @ 44100 Hz), stereo interleaved
    const std::size_t half = 1024;
    const std::size_t ch = 2;
    std::vector<float> bins(half * ch, 0.0f);

    // Inject strong bass (~86 Hz -> bin ~4) and mild treble (~4.3 kHz -> bin ~200)
    bins[4 * ch + 0] = 0.6f;
    bins[4 * ch + 1] = 0.6f;
    bins[200 * ch + 0] = 0.12f;
    bins[200 * ch + 1] = 0.12f;

    const bool active = analyzer.stepSpectrumBins(bins.data(), half, ch, 44100, 0.033);
    assert(active);
    assert(!analyzer.isIdle());
    assert(analyzer.bass() > 0.1f);

    auto const& b = analyzer.bands();
    // Bass band around 86 Hz (~index 12..18) should be higher than quiet sub-bass (~index 0..3)
    float peakLow = 0.0f;
    for (std::size_t i = 8; i < 24; ++i) peakLow = std::max(peakLow, b[i]);
    float peakHigh = 0.0f;
    for (std::size_t i = 45; i < 65; ++i) peakHigh = std::max(peakHigh, b[i]);
    assert(peakLow > 0.25f);
    assert(peakHigh > 0.2f);
}

void testDecayToIdle() {
    FftBandAnalyzer analyzer;
    std::vector<float> bins(1024 * 2, 0.35f);
    analyzer.stepSpectrumBins(bins.data(), 1024, 2, 48000, 0.05);
    assert(analyzer.bass() > 0.2f);

    int steps = 0;
    while (analyzer.stepDecay(0.05) && steps < 200) {
        ++steps;
    }
    assert(steps > 1 && steps < 200);
    assert(analyzer.isIdle());
    assert(analyzer.bass() == 0.0f);
    for (float v : analyzer.bands()) assert(v == 0.0f);
    // Once settled idle, stepDecay returns false (no more frames needed)
    assert(!analyzer.stepDecay(0.05));
}

} // namespace

int main() {
    testLogBandsAndResponse();
    testDecayToIdle();
    std::cout << "fft_stream.test passed!" << std::endl;
    return 0;
}
