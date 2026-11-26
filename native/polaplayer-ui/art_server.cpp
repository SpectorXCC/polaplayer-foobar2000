#include "art_server.hpp"
#include <objbase.h>
#include <oleauto.h>
#include <wincodec.h>
#include "WebView2.h"
#include <winrt/Windows.Foundation.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <fstream>
#include <mutex>
#include <shared_mutex>
#include <thread>
#include <unordered_map>

namespace pola {
namespace {

namespace fs = std::filesystem;

constexpr std::uint32_t kDefaultPalette[10] = {
    0x533E8C, 0x1E786E, 0x96405C, 0x2B5CA0, 0x785C2C,
    0x3A7840, 0x8C5078, 0x346496, 0x604834, 0x464660
};

struct EncodedArt {
    std::vector<unsigned char> bytes;
    std::string contentType;
    std::string hue;
    int width = 0;
    int height = 0;
};

struct DecodedImage {
    std::vector<unsigned char> bgra; // 32bpp premultiplied/straight BGRA
    int width = 0;
    int height = 0;
};

std::uint64_t fnv1a64(std::string_view text) {
    std::uint64_t h = 14695981039346656037ull;
    for (unsigned char c : text) {
        h ^= c;
        h *= 1099511628211ull;
    }
    return h;
}

std::string toHex64(std::uint64_t value) {
    char buf[17]{};
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(value));
    return buf;
}

std::string rgbToHex(int r, int g, int b) {
    char buf[8]{};
    std::snprintf(buf, sizeof(buf), "#%02x%02x%02x",
        std::clamp(r, 0, 255), std::clamp(g, 0, 255), std::clamp(b, 0, 255));
    return buf;
}

std::string urlEncodeAscii(std::string_view input) {
    constexpr char hex[] = "0123456789ABCDEF";
    std::string out;
    out.reserve(input.size() * 2);
    for (unsigned char c : input) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 15]);
        }
    }
    return out;
}

std::string urlDecodeAscii(std::string_view input) {
    auto hexVal = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    std::string out;
    out.reserve(input.size());
    for (std::size_t i = 0; i < input.size(); ++i) {
        if (input[i] == '%' && i + 2 < input.size()) {
            int hi = hexVal(input[i + 1]);
            int lo = hexVal(input[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(input[i] == '+' ? ' ' : input[i]);
    }
    return out;
}

template<typename T>
struct ComPtr {
    T* ptr = nullptr;
    ComPtr() = default;
    ~ComPtr() { reset(); }
    ComPtr(ComPtr const&) = delete;
    ComPtr& operator=(ComPtr const&) = delete;
    void reset(T* next = nullptr) {
        if (ptr) ptr->Release();
        ptr = next;
    }
    T** put() { reset(); return &ptr; }
    T* operator->() const { return ptr; }
    explicit operator bool() const { return ptr != nullptr; }
};

IWICImagingFactory* wicFactory() {
    thread_local IWICImagingFactory* factory = nullptr;
    if (!factory) {
        CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
            IID_PPV_ARGS(&factory));
    }
    return factory;
}

std::optional<IStream*> createMemoryStream(const void* data, std::size_t size) {
    HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, std::max<std::size_t>(1, size));
    if (!mem) return std::nullopt;
    if (size > 0 && data) {
        void* locked = GlobalLock(mem);
        if (!locked) {
            GlobalFree(mem);
            return std::nullopt;
        }
        std::memcpy(locked, data, size);
        GlobalUnlock(mem);
    }
    IStream* stream = nullptr;
    if (FAILED(CreateStreamOnHGlobal(mem, TRUE, &stream)) || !stream) {
        GlobalFree(mem);
        return std::nullopt;
    }
    return stream;
}

std::string computeDominantHue(const DecodedImage& img) {
    if (img.bgra.empty() || img.width <= 0 || img.height <= 0) return {};
    const int stepX = std::max(1, img.width / 24);
    const int stepY = std::max(1, img.height / 24);
    double sumR = 0, sumG = 0, sumB = 0, totalW = 0;
    for (int y = 0; y < img.height; y += stepY) {
        for (int x = 0; x < img.width; x += stepX) {
            const std::size_t idx = (static_cast<std::size_t>(y) * img.width + x) * 4;
            const double b = img.bgra[idx + 0];
            const double g = img.bgra[idx + 1];
            const double r = img.bgra[idx + 2];
            const double maxC = std::max({r, g, b});
            const double minC = std::min({r, g, b});
            const double lum = (r + g + b) / (3.0 * 255.0);
            if (lum < 0.06 || lum > 0.94) continue;
            const double sat = maxC > 0 ? (maxC - minC) / maxC : 0.0;
            const double w = 0.25 + sat * 2.5;
            sumR += r * w;
            sumG += g * w;
            sumB += b * w;
            totalW += w;
        }
    }
    if (totalW <= 0.01) {
        // Fallback average over all samples
        double r0 = 0, g0 = 0, b0 = 0;
        int n = 0;
        for (int y = 0; y < img.height; y += stepY) {
            for (int x = 0; x < img.width; x += stepX) {
                const std::size_t idx = (static_cast<std::size_t>(y) * img.width + x) * 4;
                b0 += img.bgra[idx + 0];
                g0 += img.bgra[idx + 1];
                r0 += img.bgra[idx + 2];
                ++n;
            }
        }
        if (n == 0) return {};
        return rgbToHex(static_cast<int>(r0 / n), static_cast<int>(g0 / n), static_cast<int>(b0 / n));
    }
    return rgbToHex(
        static_cast<int>(sumR / totalW),
        static_cast<int>(sumG / totalW),
        static_cast<int>(sumB / totalW));
}

std::optional<DecodedImage> decodeAndScale(const void* bytes, std::size_t size, int maxSidePx, bool cropSquare, int exactSquarePx) {
    auto* factory = wicFactory();
    if (!factory || !bytes || size == 0) return std::nullopt;
    auto streamOpt = createMemoryStream(bytes, size);
    if (!streamOpt) return std::nullopt;
    ComPtr<IStream> stream;
    stream.reset(*streamOpt);

    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromStream(stream.ptr, nullptr, WICDecodeMetadataCacheOnDemand, decoder.put())))
        return std::nullopt;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, frame.put()))) return std::nullopt;

    UINT srcW = 0, srcH = 0;
    if (FAILED(frame->GetSize(&srcW, &srcH)) || srcW == 0 || srcH == 0) return std::nullopt;

    ComPtr<IWICBitmapSource> source;
    if (cropSquare && srcW != srcH) {
        const UINT side = std::min(srcW, srcH);
        const UINT cropX = (srcW - side) / 2;
        const UINT cropY = (srcH - side) / 2;
        WICRect clip{static_cast<INT>(cropX), static_cast<INT>(cropY), static_cast<INT>(side), static_cast<INT>(side)};
        ComPtr<IWICBitmapClipper> clipper;
        if (SUCCEEDED(factory->CreateBitmapClipper(clipper.put())) &&
            SUCCEEDED(clipper->Initialize(frame.ptr, &clip))) {
            source.reset(clipper.ptr);
            clipper.ptr->AddRef();
            srcW = srcH = side;
        }
    }
    if (!source) {
        source.reset(frame.ptr);
        frame.ptr->AddRef();
    }

    UINT dstW = srcW, dstH = srcH;
    if (exactSquarePx > 0) {
        dstW = dstH = static_cast<UINT>(exactSquarePx);
    } else if (maxSidePx > 0 && static_cast<int>(std::max(srcW, srcH)) > maxSidePx) {
        const double ratio = static_cast<double>(maxSidePx) / static_cast<double>(std::max(srcW, srcH));
        dstW = std::max<UINT>(1, static_cast<UINT>(std::lround(srcW * ratio)));
        dstH = std::max<UINT>(1, static_cast<UINT>(std::lround(srcH * ratio)));
    }

    if (dstW != srcW || dstH != srcH) {
        ComPtr<IWICBitmapScaler> scaler;
        if (SUCCEEDED(factory->CreateBitmapScaler(scaler.put())) &&
            SUCCEEDED(scaler->Initialize(source.ptr, dstW, dstH, WICBitmapInterpolationModeFant))) {
            source.reset(scaler.ptr);
            scaler.ptr->AddRef();
        }
    }

    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(converter.put()))) return std::nullopt;
    if (FAILED(converter->Initialize(source.ptr, GUID_WICPixelFormat32bppBGRA,
        WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom)))
        return std::nullopt;

    DecodedImage out;
    out.width = static_cast<int>(dstW);
    out.height = static_cast<int>(dstH);
    const UINT stride = dstW * 4;
    out.bgra.resize(static_cast<std::size_t>(stride) * dstH);
    if (FAILED(converter->CopyPixels(nullptr, stride, static_cast<UINT>(out.bgra.size()), out.bgra.data())))
        return std::nullopt;
    return out;
}

std::optional<std::vector<unsigned char>> encodePngOrJpg(const DecodedImage& img, bool jpeg, std::string& contentTypeOut) {
    auto* factory = wicFactory();
    if (!factory || img.bgra.empty() || img.width <= 0 || img.height <= 0) return std::nullopt;

    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()))) return std::nullopt;

    ComPtr<IWICBitmapEncoder> encoder;
    const GUID fmt = jpeg ? GUID_ContainerFormatJpeg : GUID_ContainerFormatPng;
    if (FAILED(factory->CreateEncoder(fmt, nullptr, encoder.put()))) return std::nullopt;
    if (FAILED(encoder->Initialize(stream.ptr, WICBitmapEncoderNoCache))) return std::nullopt;

    ComPtr<IWICBitmapFrameEncode> frame;
    if (FAILED(encoder->CreateNewFrame(frame.put(), nullptr))) return std::nullopt;
    if (FAILED(frame->Initialize(nullptr))) return std::nullopt;
    if (FAILED(frame->SetSize(static_cast<UINT>(img.width), static_cast<UINT>(img.height)))) return std::nullopt;

    WICPixelFormatGUID pixFmt = jpeg ? GUID_WICPixelFormat24bppBGR : GUID_WICPixelFormat32bppBGRA;
    if (FAILED(frame->SetPixelFormat(&pixFmt))) return std::nullopt;

    if (pixFmt == GUID_WICPixelFormat32bppBGRA) {
        const UINT stride = static_cast<UINT>(img.width) * 4;
        if (FAILED(frame->WritePixels(static_cast<UINT>(img.height), stride,
            static_cast<UINT>(img.bgra.size()), const_cast<BYTE*>(img.bgra.data()))))
            return std::nullopt;
    } else {
        // Convert 32bpp BGRA -> 24bpp BGR for JPEG
        const UINT stride24 = static_cast<UINT>(img.width) * 3;
        std::vector<unsigned char> bgr(static_cast<std::size_t>(stride24) * img.height);
        for (int y = 0; y < img.height; ++y) {
            for (int x = 0; x < img.width; ++x) {
                const std::size_t s = (static_cast<std::size_t>(y) * img.width + x) * 4;
                const std::size_t d = (static_cast<std::size_t>(y) * img.width + x) * 3;
                bgr[d + 0] = img.bgra[s + 0];
                bgr[d + 1] = img.bgra[s + 1];
                bgr[d + 2] = img.bgra[s + 2];
            }
        }
        if (FAILED(frame->WritePixels(static_cast<UINT>(img.height), stride24,
            static_cast<UINT>(bgr.size()), bgr.data())))
            return std::nullopt;
    }

    if (FAILED(frame->Commit()) || FAILED(encoder->Commit())) return std::nullopt;

    HGLOBAL hMem = nullptr;
    if (FAILED(GetHGlobalFromStream(stream.ptr, &hMem)) || !hMem) return std::nullopt;
    const SIZE_T total = GlobalSize(hMem);
    void* locked = GlobalLock(hMem);
    if (!locked || total == 0) return std::nullopt;
    std::vector<unsigned char> result(total);
    std::memcpy(result.data(), locked, total);
    GlobalUnlock(hMem);
    contentTypeOut = jpeg ? "image/jpeg" : "image/png";
    return result;
}

std::optional<album_art_data_ptr> queryLocalArtById(metadb_handle_ptr const& track, GUID const& artId, abort_callback& abort) {
    if (!track.is_valid()) return std::nullopt;
    try {
        const auto ids = pfc::list_single_ref_t<GUID>(artId);
        const auto items = pfc::list_single_ref_t<metadb_handle_ptr>(track);
        auto art = album_art_manager_v2::get()->open(items, ids, abort)->query(artId, abort);
        constexpr std::size_t coverLimit = 16 * 1024 * 1024;
        if (art.is_valid() && art->size() > 0 && art->size() <= coverLimit) return art;
    } catch (...) {}
    return std::nullopt;
}

std::optional<album_art_data_ptr> queryLocalFrontArt(metadb_handle_ptr const& track, abort_callback& abort) {
    return queryLocalArtById(track, album_art_ids::cover_front, abort);
}

std::optional<album_art_data_ptr> queryLocalArtistArt(metadb_handle_ptr const& track, abort_callback& abort) {
    return queryLocalArtById(track, album_art_ids::artist, abort);
}

void buildWebResponse(
    ICoreWebView2Environment* env,
    ICoreWebView2WebResourceRequestedEventArgs* args,
    EncodedArt const* art,
    bool notFound) {
    if (!env || !args) return;
    if (notFound || !art || art->bytes.empty()) {
        ComPtr<ICoreWebView2WebResourceResponse> resp;
        if (SUCCEEDED(env->CreateWebResourceResponse(
                nullptr, 404, L"Not Found",
                L"Access-Control-Allow-Origin: https://app.verdant.local\r\nCache-Control: no-store",
                resp.put())) && resp) {
            args->put_Response(resp.ptr);
        }
        return;
    }
    auto streamOpt = createMemoryStream(art->bytes.data(), art->bytes.size());
    if (!streamOpt) return;
    ComPtr<IStream> stream;
    stream.reset(*streamOpt);

    const auto ctW = std::wstring(art->contentType.begin(), art->contentType.end());
    const auto hueW = std::wstring(art->hue.begin(), art->hue.end());
    std::wstring headers =
        L"Content-Type: " + ctW + L"\r\n" +
        L"Cache-Control: public, max-age=3600\r\n" +
        L"Access-Control-Allow-Origin: https://app.verdant.local\r\n" +
        L"Access-Control-Expose-Headers: X-Pola-Hue, X-Pola-Width, X-Pola-Height\r\n" +
        (hueW.empty() ? L"" : L"X-Pola-Hue: " + hueW + L"\r\n") +
        L"X-Pola-Width: " + std::to_wstring(art->width) + L"\r\n" +
        L"X-Pola-Height: " + std::to_wstring(art->height);

    ComPtr<ICoreWebView2WebResourceResponse> resp;
    if (SUCCEEDED(env->CreateWebResourceResponse(stream.ptr, 200, L"OK", headers.c_str(), resp.put())) && resp) {
        args->put_Response(resp.ptr);
    }
}

struct PendingDeferral {
    ICoreWebView2Environment* env = nullptr;
    ICoreWebView2WebResourceRequestedEventArgs* args = nullptr;
    ICoreWebView2Deferral* deferral = nullptr;
    std::string cacheKey;
    std::string routeKind; // "track" | "pl" | "lib" | "nv"
    std::string routeArg;
    int sizePx = 400;
};

struct CompletedDeferral {
    PendingDeferral req;
    std::shared_ptr<EncodedArt> art; // nullptr -> 404
};

} // namespace

struct ArtServer::Impl {
    HWND notifyHwnd = nullptr;
    UINT notifyMsg = 0;
    fs::path diskDir;

    mutable std::shared_mutex dataMutex;
    nav::Config navConfig;
    std::unordered_map<std::string, metadb_handle_ptr> tracksByHash;
    std::unordered_map<std::string, std::vector<metadb_handle_ptr>> playlistCands;
    std::unordered_map<std::string, std::vector<metadb_handle_ptr>> artistCands;
    std::vector<metadb_handle_ptr> libraryCands;

    std::unordered_map<std::string, std::shared_ptr<EncodedArt>> memCache;
    std::deque<std::string> memOrder;
    std::unordered_map<std::string, std::string> hues;
    std::deque<HueEvent> hueEvents;
    static constexpr std::size_t kMaxMemEntries = 180;

    std::mutex queueMutex;
    std::condition_variable queueCv;
    std::deque<PendingDeferral> pending;
    std::deque<CompletedDeferral> completed;
    bool stopping = false;
    std::vector<std::thread> workers;

    void startWorkers() {
        if (!workers.empty()) return;
        stopping = false;
        for (int i = 0; i < 3; ++i) {
            workers.emplace_back([this] { workerLoop(); });
        }
    }

    void stopWorkers() {
        {
            std::lock_guard lock(queueMutex);
            stopping = true;
        }
        queueCv.notify_all();
        for (auto& t : workers) {
            if (t.joinable()) t.join();
        }
        workers.clear();

        std::lock_guard lock(queueMutex);
        while (!pending.empty()) {
            auto item = std::move(pending.front());
            pending.pop_front();
            releaseCom(item);
        }
        while (!completed.empty()) {
            auto item = std::move(completed.front());
            completed.pop_front();
            releaseCom(item.req);
        }
    }

    static void releaseCom(PendingDeferral& item) {
        if (item.deferral) { item.deferral->Release(); item.deferral = nullptr; }
        if (item.args) { item.args->Release(); item.args = nullptr; }
        if (item.env) { item.env->Release(); item.env = nullptr; }
    }

    void rememberMem(std::string const& cacheKey, std::shared_ptr<EncodedArt> const& art, std::string const& hueKey) {
        std::unique_lock lock(dataMutex);
        if (art && !art->bytes.empty()) {
            if (!memCache.contains(cacheKey)) {
                if (memOrder.size() >= kMaxMemEntries) {
                    auto oldest = std::move(memOrder.front());
                    memOrder.pop_front();
                    memCache.erase(oldest);
                }
                memOrder.push_back(cacheKey);
            }
            memCache[cacheKey] = art;
            if (!art->hue.empty() && !hueKey.empty()) {
                auto it = hues.find(hueKey);
                if (it == hues.end() || it->second != art->hue) {
                    hues[hueKey] = art->hue;
                    if (hueEvents.size() < 256) hueEvents.push_back({hueKey, art->hue});
                }
            }
        }
    }

    std::shared_ptr<EncodedArt> loadFromDisk(std::string const& cacheKey) {
        if (diskDir.empty()) return nullptr;
        const auto file = diskDir / (toHex64(fnv1a64(cacheKey)) + ".cache");
        std::error_code ec;
        if (!fs::exists(file, ec)) return nullptr;
        std::ifstream in(file, std::ios::binary);
        if (!in) return nullptr;
        char header[24]{};
        if (!in.read(header, sizeof(header))) return nullptr;
        if (std::memcmp(header, "PLART1", 6) != 0) return nullptr;
        const bool isJpg = header[6] == 'J';
        char hueBuf[8]{};
        std::memcpy(hueBuf, header + 7, 7);
        int w = 0, h = 0;
        std::memcpy(&w, header + 14, 4);
        std::memcpy(&h, header + 18, 4);
        std::vector<unsigned char> payload((std::istreambuf_iterator<char>(in)), {});
        if (payload.empty() || payload.size() > 16 * 1024 * 1024) return nullptr;
        auto art = std::make_shared<EncodedArt>();
        art->bytes = std::move(payload);
        art->contentType = isJpg ? "image/jpeg" : "image/png";
        art->hue = std::string(hueBuf);
        art->width = w;
        art->height = h;
        return art;
    }

    void saveToDisk(std::string const& cacheKey, EncodedArt const& art) {
        if (diskDir.empty() || art.bytes.empty()) return;
        std::error_code ec;
        fs::create_directories(diskDir, ec);
        if (ec) return;
        const auto hex = toHex64(fnv1a64(cacheKey));
        const auto target = diskDir / (hex + ".cache");
        const auto tmp = diskDir / (hex + ".tmp");
        char header[24]{};
        std::memcpy(header, "PLART1", 6);
        header[6] = (art.contentType == "image/jpeg") ? 'J' : 'P';
        if (art.hue.size() == 7) std::memcpy(header + 7, art.hue.data(), 7);
        std::memcpy(header + 14, &art.width, 4);
        std::memcpy(header + 18, &art.height, 4);
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return;
        out.write(header, sizeof(header));
        out.write(reinterpret_cast<const char*>(art.bytes.data()), static_cast<std::streamsize>(art.bytes.size()));
        out.close();
        if (out) MoveFileExW(tmp.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING);
        else DeleteFileW(tmp.c_str());
    }

    std::shared_ptr<EncodedArt> buildArt(PendingDeferral const& req, std::string& hueKeyOut) {
        if (auto disk = loadFromDisk(req.cacheKey)) {
            if (req.routeKind == "track") hueKeyOut = "track:" + req.routeArg;
            else if (req.routeKind == "pl") hueKeyOut = "pl:" + req.routeArg;
            else if (req.routeKind == "ar") hueKeyOut = "ar:" + req.routeArg;
            else if (req.routeKind == "lib") hueKeyOut = "lib";
            else if (req.routeKind == "nv") hueKeyOut = "nv:" + req.routeArg;
            return disk;
        }

        abort_callback_impl abort;
        if (req.routeKind == "track") {
            hueKeyOut = "track:" + req.routeArg;
            metadb_handle_ptr h;
            {
                std::shared_lock lock(dataMutex);
                auto it = tracksByHash.find(req.routeArg);
                if (it != tracksByHash.end()) h = it->second;
            }
            auto raw = queryLocalFrontArt(h, abort);
            if (!raw) return nullptr;
            auto dec = decodeAndScale((*raw)->data(), (*raw)->size(), req.sizePx, false, 0);
            if (!dec) return nullptr;
            std::string ct;
            auto encoded = encodePngOrJpg(*dec, false, ct);
            if (!encoded) return nullptr;
            auto art = std::make_shared<EncodedArt>();
            art->bytes = std::move(*encoded);
            art->contentType = std::move(ct);
            art->hue = computeDominantHue(*dec);
            art->width = dec->width;
            art->height = dec->height;
            saveToDisk(req.cacheKey, *art);
            return art;
        }

        if (req.routeKind == "pl" || req.routeKind == "lib") {
            hueKeyOut = (req.routeKind == "pl") ? ("pl:" + req.routeArg) : "lib";
            std::vector<metadb_handle_ptr> cands;
            {
                std::shared_lock lock(dataMutex);
                if (req.routeKind == "lib") cands = libraryCands;
                else {
                    auto it = playlistCands.find(req.routeArg);
                    if (it != playlistCands.end()) cands = it->second;
                }
            }
            std::vector<DecodedImage> cells;
            std::optional<album_art_data_ptr> firstRaw;
            const int tileSide = std::max(80, req.sizePx / 2);
            for (auto const& h : cands) {
                if (stopping) return nullptr;
                auto raw = queryLocalFrontArt(h, abort);
                if (!raw) continue;
                if (!firstRaw) firstRaw = raw;
                auto dec = decodeAndScale((*raw)->data(), (*raw)->size(), tileSide, true, tileSide);
                if (dec) cells.push_back(std::move(*dec));
                if (cells.size() >= 4) break;
            }
            if (!firstRaw || cells.empty()) return nullptr;
            if (cells.size() < 4) {
                // Use first cover cleanly preserving its aspect ratio.
                auto dec = decodeAndScale((*firstRaw)->data(), (*firstRaw)->size(), req.sizePx, false, 0);
                if (!dec) return nullptr;
                std::string ct;
                auto encoded = encodePngOrJpg(*dec, true, ct);
                if (!encoded) return nullptr;
                auto art = std::make_shared<EncodedArt>();
                art->bytes = std::move(*encoded);
                art->contentType = std::move(ct);
                art->hue = computeDominantHue(*dec);
                art->width = dec->width;
                art->height = dec->height;
                saveToDisk(req.cacheKey, *art);
                return art;
            }
            // Composite 2x2 mosaic
            const int side = tileSide * 2;
            DecodedImage mosaic;
            mosaic.width = side;
            mosaic.height = side;
            mosaic.bgra.resize(static_cast<std::size_t>(side) * side * 4, 255);
            for (int q = 0; q < 4; ++q) {
                const int ox = (q % 2) * tileSide;
                const int oy = (q / 2) * tileSide;
                auto const& c = cells[q];
                for (int y = 0; y < tileSide; ++y) {
                    const auto* srcRow = c.bgra.data() + static_cast<std::size_t>(y) * tileSide * 4;
                    auto* dstRow = mosaic.bgra.data() + (static_cast<std::size_t>(oy + y) * side + ox) * 4;
                    std::memcpy(dstRow, srcRow, static_cast<std::size_t>(tileSide) * 4);
                }
            }
            std::string ct;
            auto encoded = encodePngOrJpg(mosaic, true, ct);
            if (!encoded) return nullptr;
            auto art = std::make_shared<EncodedArt>();
            art->bytes = std::move(*encoded);
            art->contentType = std::move(ct);
            art->hue = computeDominantHue(mosaic);
            art->width = mosaic.width;
            art->height = mosaic.height;
            saveToDisk(req.cacheKey, *art);
            return art;
        }

        if (req.routeKind == "ar") {
            hueKeyOut = "ar:" + req.routeArg;
            std::vector<metadb_handle_ptr> cands;
            {
                std::shared_lock lock(dataMutex);
                auto it = artistCands.find(req.routeArg);
                if (it != artistCands.end()) cands = it->second;
            }
            std::optional<album_art_data_ptr> found;
            for (auto const& h : cands) {
                if (stopping) return nullptr;
                found = queryLocalArtistArt(h, abort);
                if (found) break;
            }
            if (!found) {
                for (auto const& h : cands) {
                    if (stopping) return nullptr;
                    found = queryLocalFrontArt(h, abort);
                    if (found) break;
                }
            }
            if (!found) return nullptr;
            auto dec = decodeAndScale((*found)->data(), (*found)->size(), req.sizePx, true, req.sizePx);
            if (!dec) return nullptr;
            std::string ct;
            auto encoded = encodePngOrJpg(*dec, true, ct);
            if (!encoded) return nullptr;
            auto art = std::make_shared<EncodedArt>();
            art->bytes = std::move(*encoded);
            art->contentType = std::move(ct);
            art->hue = computeDominantHue(*dec);
            art->width = dec->width;
            art->height = dec->height;
            saveToDisk(req.cacheKey, *art);
            return art;
        }

        if (req.routeKind == "nv") {
            hueKeyOut = "nv:" + req.routeArg;
            nav::Config cfg;
            {
                std::shared_lock lock(dataMutex);
                cfg = navConfig;
            }
            auto coverIdW = winrt::to_hstring(req.routeArg);
            auto blob = nav::fetchCoverSync(cfg, coverIdW, req.sizePx);
            if (!blob || blob->bytes.empty()) return nullptr;
            auto dec = decodeAndScale(blob->bytes.data(), blob->bytes.size(), req.sizePx, false, 0);
            if (!dec) return nullptr;
            std::string ct;
            auto encoded = encodePngOrJpg(*dec, blob->suffix == L"jpg", ct);
            if (!encoded) return nullptr;
            auto art = std::make_shared<EncodedArt>();
            art->bytes = std::move(*encoded);
            art->contentType = std::move(ct);
            art->hue = computeDominantHue(*dec);
            art->width = dec->width;
            art->height = dec->height;
            saveToDisk(req.cacheKey, *art);
            return art;
        }
        return nullptr;
    }

    void workerLoop() {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        while (true) {
            PendingDeferral job;
            {
                std::unique_lock lock(queueMutex);
                queueCv.wait(lock, [&] { return stopping || !pending.empty(); });
                if (stopping && pending.empty()) break;
                job = std::move(pending.front());
                pending.pop_front();
            }
            std::string hueKey;
            auto art = buildArt(job, hueKey);
            if (art && !art->bytes.empty()) {
                rememberMem(job.cacheKey, art, hueKey);
            }
            HWND targetHwnd = nullptr;
            UINT targetMsg = 0;
            {
                std::lock_guard lock(queueMutex);
                if (stopping) {
                    releaseCom(job);
                    break;
                }
                completed.push_back({std::move(job), std::move(art)});
                targetHwnd = notifyHwnd;
                targetMsg = notifyMsg;
            }
            if (targetHwnd && targetMsg) {
                PostMessageW(targetHwnd, targetMsg, 0, 0);
            }
        }
        CoUninitialize();
    }
};

ArtServer::ArtServer() : impl_(std::make_unique<Impl>()) {}
ArtServer::~ArtServer() { shutdown(); }

void ArtServer::initialize(HWND notifyHwnd, UINT notifyMsg, fs::path cacheDir) {
    impl_->notifyHwnd = notifyHwnd;
    impl_->notifyMsg = notifyMsg;
    impl_->diskDir = std::move(cacheDir) / L"art-v1";
    impl_->startWorkers();
}

void ArtServer::shutdown() {
    if (!impl_) return;
    impl_->notifyHwnd = nullptr;
    impl_->stopWorkers();
}

void ArtServer::setNavConfig(nav::Config const& config) {
    std::unique_lock lock(impl_->dataMutex);
    impl_->navConfig = config;
}

std::string ArtServer::registerTrack(metadb_handle_ptr const& track) {
    if (!track.is_valid()) return {};
    std::string keySource = track->get_path() ? track->get_path() : "";
    keySource.push_back('|');
    keySource += std::to_string(track->get_subsong_index());
    const auto hash = toHex64(fnv1a64(keySource));
    {
        std::unique_lock lock(impl_->dataMutex);
        if (impl_->tracksByHash.size() >= 131072 && !impl_->tracksByHash.contains(hash)) {
            impl_->tracksByHash.erase(impl_->tracksByHash.begin());
        }
        impl_->tracksByHash[hash] = track;
    }
    return hash;
}

void ArtServer::registerPlaylistCandidates(std::string const& playlistId, std::uint64_t, std::vector<metadb_handle_ptr> candidates) {
    std::unique_lock lock(impl_->dataMutex);
    impl_->playlistCands[playlistId] = std::move(candidates);
}

void ArtServer::registerArtistCandidates(std::string const& artistKey, std::uint64_t, std::vector<metadb_handle_ptr> candidates) {
    std::unique_lock lock(impl_->dataMutex);
    impl_->artistCands[artistKey] = std::move(candidates);
}

void ArtServer::registerLibraryCandidates(std::uint64_t, std::vector<metadb_handle_ptr> candidates) {
    std::unique_lock lock(impl_->dataMutex);
    impl_->libraryCands = std::move(candidates);
}

std::string ArtServer::trackArtUrl(std::string const& hash, int sizePx) {
    if (hash.empty()) return {};
    return "https://art.verdant.local/track/" + hash + "?s=" + std::to_string(std::clamp(sizePx, 64, 1600));
}

std::string ArtServer::playlistArtUrl(std::string const& playlistId, std::uint64_t revision, int sizePx) {
    if (playlistId.empty()) return {};
    return "https://art.verdant.local/pl/" + urlEncodeAscii(playlistId) +
        "?rev=" + std::to_string(revision) + "&s=" + std::to_string(std::clamp(sizePx, 64, 800));
}

std::string ArtServer::artistArtUrl(std::string const& artistKey, std::uint64_t revision, int sizePx) {
    if (artistKey.empty()) return {};
    return "https://art.verdant.local/ar/" + urlEncodeAscii(artistKey) +
        "?rev=" + std::to_string(revision) + "&s=" + std::to_string(std::clamp(sizePx, 64, 800));
}

std::string ArtServer::libraryArtUrl(std::uint64_t revision, int sizePx) {
    return "https://art.verdant.local/lib?rev=" + std::to_string(revision) +
        "&s=" + std::to_string(std::clamp(sizePx, 64, 800));
}

std::string ArtServer::navArtUrl(std::wstring const& serverKeyHex, std::wstring const& coverId, int sizePx) {
    if (coverId.empty()) return {};
    const auto idUtf8 = winrt::to_string(coverId);
    const auto srvUtf8 = winrt::to_string(serverKeyHex);
    return "https://art.verdant.local/nv/" + urlEncodeAscii(idUtf8) +
        "?srv=" + urlEncodeAscii(srvUtf8) + "&s=" + std::to_string(std::clamp(sizePx, 64, 1600));
}

std::string ArtServer::cachedHue(std::string const& artKey) const {
    std::shared_lock lock(impl_->dataMutex);
    auto it = impl_->hues.find(artKey);
    return it == impl_->hues.end() ? std::string{} : it->second;
}

std::vector<ArtServer::HueEvent> ArtServer::drainHues() {
    std::unique_lock lock(impl_->dataMutex);
    std::vector<HueEvent> out;
    out.reserve(impl_->hueEvents.size());
    for (auto& ev : impl_->hueEvents) out.push_back(std::move(ev));
    impl_->hueEvents.clear();
    return out;
}

void ArtServer::flushCompletedResponses() {
    std::deque<CompletedDeferral> batch;
    {
        std::lock_guard lock(impl_->queueMutex);
        batch.swap(impl_->completed);
    }
    while (!batch.empty()) {
        auto item = std::move(batch.front());
        batch.pop_front();
        buildWebResponse(item.req.env, item.req.args, item.art.get(), !item.art);
        if (item.req.deferral) item.req.deferral->Complete();
        Impl::releaseCom(item.req);
    }
}

bool ArtServer::handleWebResource(void* ctx, const wchar_t* uriW, void* envPtr, void* argsPtr) {
    auto* self = static_cast<ArtServer*>(ctx);
    auto* env = static_cast<ICoreWebView2Environment*>(envPtr);
    auto* args = static_cast<ICoreWebView2WebResourceRequestedEventArgs*>(argsPtr);
    if (!self || !uriW || !env || !args) return false;

    const std::string uri = winrt::to_string(uriW);
    constexpr std::string_view prefix = "https://art.verdant.local/";
    if (!uri.starts_with(prefix)) return false;

    std::string_view rest(uri);
    rest.remove_prefix(prefix.size());
    const auto qPos = rest.find('?');
    const std::string_view pathPart = rest.substr(0, qPos);
    const std::string_view queryPart = (qPos == rest.npos) ? std::string_view{} : rest.substr(qPos + 1);

    int sizePx = 400;
    std::string rev, srv;
    std::string_view q = queryPart;
    while (!q.empty()) {
        const auto amp = q.find('&');
        const auto seg = q.substr(0, amp);
        const auto eq = seg.find('=');
        if (eq != seg.npos) {
            const auto k = seg.substr(0, eq);
            const auto v = urlDecodeAscii(seg.substr(eq + 1));
            if (k == "s") {
                try { sizePx = std::clamp(std::stoi(v), 64, 1600); } catch (...) {}
            } else if (k == "rev") rev = v;
            else if (k == "srv") srv = v;
        }
        if (amp == q.npos) break;
        q.remove_prefix(amp + 1);
    }

    std::string kind, arg;
    if (pathPart.starts_with("track/")) {
        kind = "track";
        arg = urlDecodeAscii(pathPart.substr(6));
    } else if (pathPart.starts_with("pl/")) {
        kind = "pl";
        arg = urlDecodeAscii(pathPart.substr(3));
    } else if (pathPart.starts_with("ar/")) {
        kind = "ar";
        arg = urlDecodeAscii(pathPart.substr(3));
    } else if (pathPart == "lib") {
        kind = "lib";
        arg = "all";
    } else if (pathPart.starts_with("nv/")) {
        kind = "nv";
        arg = urlDecodeAscii(pathPart.substr(3));
    } else {
        buildWebResponse(env, args, nullptr, true);
        return true;
    }

    const std::string cacheKey = kind + "|" + srv + "|" + arg + "|" + rev + "|" + std::to_string(sizePx);
    {
        std::shared_lock lock(self->impl_->dataMutex);
        auto it = self->impl_->memCache.find(cacheKey);
        if (it != self->impl_->memCache.end()) {
            buildWebResponse(env, args, it->second.get(), false);
            return true;
        }
    }

    ICoreWebView2Deferral* deferral = nullptr;
    if (FAILED(args->GetDeferral(&deferral)) || !deferral) {
        buildWebResponse(env, args, nullptr, true);
        return true;
    }
    env->AddRef();
    args->AddRef();

    PendingDeferral job;
    job.env = env;
    job.args = args;
    job.deferral = deferral;
    job.cacheKey = cacheKey;
    job.routeKind = std::move(kind);
    job.routeArg = std::move(arg);
    job.sizePx = sizePx;

    {
        std::lock_guard lock(self->impl_->queueMutex);
        if (self->impl_->stopping) {
            buildWebResponse(env, args, nullptr, true);
            deferral->Complete();
            Impl::releaseCom(job);
            return true;
        }
        self->impl_->pending.push_back(std::move(job));
    }
    self->impl_->queueCv.notify_one();
    return true;
}

} // namespace pola
