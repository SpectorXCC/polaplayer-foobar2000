#pragma once

#include <foobar2000/SDK/foobar2000.h>
#include "fft_stream_pure.hpp"

namespace pola::fft {

class FftStream {
public:
    void setActive(bool active) {
        if (active == active_) return;
        active_ = active;
        if (!active_) {
            stream_.release();
            analyzer_.reset();
            return;
        }
        if (auto vm = visualisation_manager::tryGet(); vm.is_valid()) {
            visualisation_stream::ptr base;
            vm->create_stream(base, visualisation_manager::KStreamFlagNewFFT);
            if (base.is_valid()) {
                if (!base->service_query_t(stream_)) {
                    // Stream without v2 is still supported through base pointer if needed,
                    // though foobar2000 0.9.5+ implements visualisation_stream_v2.
                    baseStream_ = base;
                } else {
                    baseStream_ = base;
                    stream_->request_backlog(0.08);
                }
            }
        }
    }

    void release() {
        active_ = false;
        stream_.release();
        baseStream_.release();
        analyzer_.reset();
    }

    bool active() const { return active_; }

    bool sample(bool visible, bool playing, double dtSec) {
        if (!active_) return false;
        if (!visible || !playing || !baseStream_.is_valid()) {
            return analyzer_.stepDecay(dtSec);
        }
        double t = 0.0;
        if (baseStream_->get_absolute_time(t) &&
            baseStream_->get_spectrum_absolute(chunk_, t, 2048) &&
            chunk_.get_sample_count() > 0) {
            return analyzer_.stepSpectrumBins(
                chunk_.get_data(),
                chunk_.get_sample_count(),
                chunk_.get_channels(),
                chunk_.get_srate(),
                dtSec);
        }
        return analyzer_.stepDecay(dtSec);
    }

    FftBandAnalyzer const& analyzer() const { return analyzer_; }

private:
    bool active_ = false;
    visualisation_stream::ptr baseStream_;
    visualisation_stream_v2::ptr stream_;
    audio_chunk_impl chunk_;
    FftBandAnalyzer analyzer_;
};

} // namespace pola::fft
