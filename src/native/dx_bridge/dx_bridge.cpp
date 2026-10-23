#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <GL/gl.h>
#include <node_api.h>

#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <vector>
#include <iostream>
#include <string>

// ── Modern OpenGL Definitions ────────────────────────────────
#define GL_FRAMEBUFFER                    0x8D40
#define GL_COLOR_ATTACHMENT0              0x8CE0
#define GL_FRAMEBUFFER_COMPLETE           0x8CD5
#define GL_TEXTURE_2D                     0x0DE1
#define GL_RGBA8                          0x8058
#define GL_RGBA                           0x1908
#define GL_UNSIGNED_BYTE                  0x1401
#define GL_TEXTURE_MIN_FILTER             0x2801
#define GL_TEXTURE_MAG_FILTER             0x2800
#define GL_TEXTURE_WRAP_S                 0x2802
#define GL_TEXTURE_WRAP_T                 0x2803
#define GL_CLAMP_TO_EDGE                  0x812F
#define GL_LINEAR                         0x2601

#define WGL_CONTEXT_MAJOR_VERSION_ARB     0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB     0x2092
#define WGL_CONTEXT_PROFILE_MASK_ARB      0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB  0x00000001
#define WGL_ACCESS_READ_ONLY_NV           0x00000000
#define WGL_ACCESS_READ_WRITE_NV          0x00000001
#define WGL_ACCESS_WRITE_DISCARD_NV       0x00000002

typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(HDC hDC, HGLRC hShareContext, const int* attribList);
typedef HANDLE(WINAPI* PFNWGLDXOPENDEVICENVPROC)(void* dxDevice);
typedef BOOL(WINAPI* PFNWGLDXCLOSEDEVICENVPROC)(HANDLE hDevice);
typedef HANDLE(WINAPI* PFNWGLDXREGISTEROBJECTNVPROC)(HANDLE hDevice, void* dxObject, GLuint name, GLenum type, GLenum access);
typedef BOOL(WINAPI* PFNWGLDXUNREGISTEROBJECTNVPROC)(HANDLE hDevice, HANDLE hObject);
typedef BOOL(WINAPI* PFNWGLDXLOCKOBJECTSNVPROC)(HANDLE hDevice, GLint count, HANDLE* hObjects);
typedef BOOL(WINAPI* PFNWGLDXUNLOCKOBJECTSNVPROC)(HANDLE hDevice, GLint count, HANDLE* hObjects);

typedef void(APIENTRY* PFNGLGENFRAMEBUFFERSPROC)(GLsizei n, GLuint* framebuffers);
typedef void(APIENTRY* PFNGLBINDFRAMEBUFFERPROC)(GLenum target, GLuint framebuffer);
typedef void(APIENTRY* PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
typedef GLenum(APIENTRY* PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum target);
typedef void(APIENTRY* PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei n, const GLuint* framebuffers);

static PFNWGLCREATECONTEXTATTRIBSARBPROC wglCreateContextAttribsARB = nullptr;
static PFNWGLDXOPENDEVICENVPROC wglDXOpenDeviceNV = nullptr;
static PFNWGLDXCLOSEDEVICENVPROC wglDXCloseDeviceNV = nullptr;
static PFNWGLDXREGISTEROBJECTNVPROC wglDXRegisterObjectNV = nullptr;
static PFNWGLDXUNREGISTEROBJECTNVPROC wglDXUnregisterObjectNV = nullptr;
static PFNWGLDXLOCKOBJECTSNVPROC wglDXLockObjectsNV = nullptr;
static PFNWGLDXUNLOCKOBJECTSNVPROC wglDXUnlockObjectsNV = nullptr;

static PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers = nullptr;
static PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer = nullptr;
static PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D = nullptr;
static PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus = nullptr;
static PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers = nullptr;

// ── libmpv Dynamic Render Functions ─────────────────────────
typedef int (*pfn_mpv_render_context_create)(mpv_render_context **res, mpv_handle *mpv, mpv_render_param *params);
typedef void (*pfn_mpv_render_context_set_update_callback)(mpv_render_context *ctx, mpv_render_update_fn callback, void *callback_ctx);
typedef uint64_t (*pfn_mpv_render_context_update)(mpv_render_context *ctx);
typedef int (*pfn_mpv_render_context_render)(mpv_render_context *ctx, mpv_render_param *params);
typedef void (*pfn_mpv_render_context_free)(mpv_render_context *ctx);

static HMODULE g_hLibMpv = nullptr;
static pfn_mpv_render_context_create fn_mpv_render_context_create = nullptr;
static pfn_mpv_render_context_set_update_callback fn_mpv_render_context_set_update_callback = nullptr;
static pfn_mpv_render_context_update fn_mpv_render_context_update = nullptr;
static pfn_mpv_render_context_render fn_mpv_render_context_render = nullptr;
static pfn_mpv_render_context_free fn_mpv_render_context_free = nullptr;

static bool load_libmpv_symbols() {
    if (!g_hLibMpv) {
        g_hLibMpv = GetModuleHandleA("libmpv-2.dll");
        if (!g_hLibMpv) {
            g_hLibMpv = LoadLibraryA("libmpv-2.dll");
        }
        if (!g_hLibMpv) {
            g_hLibMpv = LoadLibraryA("mpv/libmpv-2.dll");
        }
    }
    if (!g_hLibMpv) return false;

    fn_mpv_render_context_create = (pfn_mpv_render_context_create)GetProcAddress(g_hLibMpv, "mpv_render_context_create");
    fn_mpv_render_context_set_update_callback = (pfn_mpv_render_context_set_update_callback)GetProcAddress(g_hLibMpv, "mpv_render_context_set_update_callback");
    fn_mpv_render_context_update = (pfn_mpv_render_context_update)GetProcAddress(g_hLibMpv, "mpv_render_context_update");
    fn_mpv_render_context_render = (pfn_mpv_render_context_render)GetProcAddress(g_hLibMpv, "mpv_render_context_render");
    fn_mpv_render_context_free = (pfn_mpv_render_context_free)GetProcAddress(g_hLibMpv, "mpv_render_context_free");

    return fn_mpv_render_context_create && fn_mpv_render_context_update && fn_mpv_render_context_render && fn_mpv_render_context_free;
}

static void* get_gl_proc_address(void* ctx, const char* name) {
    void* p = (void*)wglGetProcAddress(name);
    if (!p || p == (void*)0x1 || p == (void*)0x2 || p == (void*)0x3 || p == (void*)-1) {
        static HMODULE hOpenGL = LoadLibraryA("opengl32.dll");
        p = (void*)GetProcAddress(hOpenGL, name);
    }
    return p;
}

// ── Multi-Buffered DirectX-OpenGL Texture Bridge ─────────────
constexpr int NUM_BUFFERS = 3;

struct BufferEntry {
    ID3D11Texture2D* d3d_render_texture = nullptr;
    ID3D11Texture2D* d3d_shared_texture = nullptr;
    IDXGIResource1* dxgi_resource1 = nullptr;
    HANDLE nt_handle = nullptr;
    GLuint gl_texture = 0;
    GLuint gl_fbo = 0;
    HANDLE gl_registered_obj = nullptr;
    std::atomic<bool> in_use{false};
};

struct FramePayload {
    int buffer_index;
    int width;
    int height;
    uint64_t generation;
};

struct RetiredBuffer {
    int index = 0;
    uint64_t generation = 0;
    ID3D11Texture2D* d3d_shared_texture = nullptr;
    IDXGIResource1* dxgi_resource1 = nullptr;
    HANDLE nt_handle = nullptr;
};

class DxBridge {
public:
    HWND dummy_hwnd = nullptr;
    HDC dummy_hdc = nullptr;
    HGLRC dummy_hglrc = nullptr;

    ID3D11Device* d3d_device = nullptr;
    ID3D11DeviceContext* d3d_context = nullptr;
    HANDLE gl_hDevice = nullptr;

    mpv_handle* mpv_ctx = nullptr;
    mpv_render_context* mpv_gl_ctx = nullptr;

    BufferEntry buffers[NUM_BUFFERS];
    std::vector<RetiredBuffer> retired_buffers;
    int current_width = 1280;
    int current_height = 720;
    int flip_y = 1;
    bool buffers_allocated = false;
    std::atomic<uint64_t> current_generation{1};

    std::atomic<uint64_t> pending_resize{0};

    std::thread render_thread;
    std::atomic<bool> running{false};
    HANDLE hWakeEvent = nullptr;
    std::mutex resize_mutex;
    std::condition_variable cv_buffer_freed;
    std::mutex buffer_mutex;

    napi_threadsafe_function tsfn = nullptr;

    DxBridge() {
        hWakeEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    }

    ~DxBridge() {
        destroy();
        if (hWakeEvent) {
            CloseHandle(hWakeEvent);
            hWakeEvent = nullptr;
        }
    }

    bool initGL() {
        WNDCLASSA wc = {};
        wc.lpfnWndProc = DefWindowProcA;
        wc.hInstance = GetModuleHandle(nullptr);
        wc.lpszClassName = "DxBridgeGLDummy";
        RegisterClassA(&wc);

        dummy_hwnd = CreateWindowExA(
            0, "DxBridgeGLDummy", "Dummy",
            WS_POPUP, 0, 0, 1, 1,
            nullptr, nullptr, wc.hInstance, nullptr
        );
        if (!dummy_hwnd) return false;

        dummy_hdc = GetDC(dummy_hwnd);

        PIXELFORMATDESCRIPTOR pfd = {};
        pfd.nSize = sizeof(pfd);
        pfd.nVersion = 1;
        pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
        pfd.iPixelType = PFD_TYPE_RGBA;
        pfd.cColorBits = 32;
        pfd.cDepthBits = 24;
        pfd.cStencilBits = 8;
        pfd.iLayerType = PFD_MAIN_PLANE;

        int format = ChoosePixelFormat(dummy_hdc, &pfd);
        if (!format) return false;
        SetPixelFormat(dummy_hdc, format, &pfd);

        HGLRC tempContext = wglCreateContext(dummy_hdc);
        if (!tempContext) return false;
        wglMakeCurrent(dummy_hdc, tempContext);

        wglCreateContextAttribsARB = (PFNWGLCREATECONTEXTATTRIBSARBPROC)wglGetProcAddress("wglCreateContextAttribsARB");
        if (wglCreateContextAttribsARB) {
            int attribs[] = {
                WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
                WGL_CONTEXT_MINOR_VERSION_ARB, 3,
                WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
                0
            };
            HGLRC coreContext = wglCreateContextAttribsARB(dummy_hdc, nullptr, attribs);
            if (coreContext) {
                wglMakeCurrent(nullptr, nullptr);
                wglDeleteContext(tempContext);
                tempContext = coreContext;
                wglMakeCurrent(dummy_hdc, tempContext);
            }
        }
        dummy_hglrc = tempContext;

        wglMakeCurrent(dummy_hdc, dummy_hglrc);
        const char* glVendor = (const char*)glGetString(GL_VENDOR);
        const char* glRenderer = (const char*)glGetString(GL_RENDERER);
        printf("[dx_bridge] OpenGL Vendor: %s, Renderer: %s\n", glVendor ? glVendor : "null", glRenderer ? glRenderer : "null");

        wglDXOpenDeviceNV = (PFNWGLDXOPENDEVICENVPROC)wglGetProcAddress("wglDXOpenDeviceNV");
        wglDXCloseDeviceNV = (PFNWGLDXCLOSEDEVICENVPROC)wglGetProcAddress("wglDXCloseDeviceNV");
        wglDXRegisterObjectNV = (PFNWGLDXREGISTEROBJECTNVPROC)wglGetProcAddress("wglDXRegisterObjectNV");
        wglDXUnregisterObjectNV = (PFNWGLDXUNREGISTEROBJECTNVPROC)wglGetProcAddress("wglDXUnregisterObjectNV");
        wglDXLockObjectsNV = (PFNWGLDXLOCKOBJECTSNVPROC)wglGetProcAddress("wglDXLockObjectsNV");
        wglDXUnlockObjectsNV = (PFNWGLDXUNLOCKOBJECTSNVPROC)wglGetProcAddress("wglDXUnlockObjectsNV");

        glGenFramebuffers = (PFNGLGENFRAMEBUFFERSPROC)wglGetProcAddress("glGenFramebuffers");
        glBindFramebuffer = (PFNGLBINDFRAMEBUFFERPROC)wglGetProcAddress("glBindFramebuffer");
        glFramebufferTexture2D = (PFNGLFRAMEBUFFERTEXTURE2DPROC)wglGetProcAddress("glFramebufferTexture2D");
        glCheckFramebufferStatus = (PFNGLCHECKFRAMEBUFFERSTATUSPROC)wglGetProcAddress("glCheckFramebufferStatus");
        glDeleteFramebuffers = (PFNGLDELETEFRAMEBUFFERSPROC)wglGetProcAddress("glDeleteFramebuffers");

        wglMakeCurrent(nullptr, nullptr);
        return (wglDXOpenDeviceNV && wglDXRegisterObjectNV && wglDXLockObjectsNV && wglDXUnlockObjectsNV);
    }

    bool initD3D11() {
        D3D_FEATURE_LEVEL featureLevels[] = {
            D3D_FEATURE_LEVEL_11_1,
            D3D_FEATURE_LEVEL_11_0,
            D3D_FEATURE_LEVEL_10_1,
            D3D_FEATURE_LEVEL_10_0
        };
        D3D_FEATURE_LEVEL createdFeatureLevel;
        UINT createDeviceFlags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;

        wglMakeCurrent(dummy_hdc, dummy_hglrc);
        const char* glVendor = (const char*)glGetString(GL_VENDOR);

        auto tryCreateAndOpen = [&](IDXGIAdapter1* adapter, D3D_DRIVER_TYPE drvType) -> bool {
            ID3D11Device* candDev = nullptr;
            ID3D11DeviceContext* candCtx = nullptr;
            HRESULT hr = D3D11CreateDevice(
                adapter,
                drvType,
                nullptr,
                createDeviceFlags,
                featureLevels,
                ARRAYSIZE(featureLevels),
                D3D11_SDK_VERSION,
                &candDev,
                &createdFeatureLevel,
                &candCtx
            );
            if (FAILED(hr)) {
                hr = D3D11CreateDevice(
                    adapter,
                    drvType,
                    nullptr,
                    createDeviceFlags,
                    featureLevels + 1,
                    ARRAYSIZE(featureLevels) - 1,
                    D3D11_SDK_VERSION,
                    &candDev,
                    &createdFeatureLevel,
                    &candCtx
                );
            }
            if (FAILED(hr) || !candDev) {
                if (candCtx) candCtx->Release();
                if (candDev) candDev->Release();
                return false;
            }
            HANDLE hGlDev = wglDXOpenDeviceNV(candDev);
            if (!hGlDev) {
                candCtx->Release();
                candDev->Release();
                return false;
            }
            d3d_device = candDev;
            d3d_context = candCtx;
            gl_hDevice = hGlDev;
            return true;
        };

        IDXGIFactory1* pFactory = nullptr;
        CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&pFactory);
        std::vector<IDXGIAdapter1*> preferredAdapters;
        std::vector<IDXGIAdapter1*> fallbackAdapters;

        if (pFactory) {
            IDXGIAdapter1* pAdapter = nullptr;
            for (UINT i = 0; pFactory->EnumAdapters1(i, &pAdapter) != DXGI_ERROR_NOT_FOUND; ++i) {
                DXGI_ADAPTER_DESC1 desc;
                pAdapter->GetDesc1(&desc);
                char descStr[128] = {};
                WideCharToMultiByte(CP_UTF8, 0, desc.Description, -1, descStr, sizeof(descStr), nullptr, nullptr);
                printf("[dx_bridge] DXGI Adapter %u: %s (VendorID 0x%04X, LUID %08lX-%08lX)\n",
                    i, descStr, desc.VendorId, desc.AdapterLuid.HighPart, desc.AdapterLuid.LowPart);

                if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) {
                    pAdapter->Release();
                    continue;
                }

                bool isVendorMatch = false;
                if (glVendor) {
                    if (strstr(glVendor, "Intel") && desc.VendorId == 0x8086) {
                        isVendorMatch = true;
                    } else if ((strstr(glVendor, "NVIDIA") || strstr(glVendor, "Nvidia")) && desc.VendorId == 0x10DE) {
                        isVendorMatch = true;
                    } else if ((strstr(glVendor, "AMD") || strstr(glVendor, "ATI") || strstr(glVendor, "Advanced Micro Devices")) &&
                               (desc.VendorId == 0x1002 || desc.VendorId == 0x1022)) {
                        isVendorMatch = true;
                    }
                }

                if (isVendorMatch) {
                    printf("[dx_bridge] Vendor-matched OpenGL GPU with DXGI Adapter %u (%s)\n", i, descStr);
                    preferredAdapters.push_back(pAdapter);
                } else {
                    fallbackAdapters.push_back(pAdapter);
                }
            }
            pFactory->Release();
        }

        bool opened = false;
        for (IDXGIAdapter1* adapter : preferredAdapters) {
            if (!opened && tryCreateAndOpen(adapter, D3D_DRIVER_TYPE_UNKNOWN)) {
                opened = true;
            }
            adapter->Release();
        }
        for (IDXGIAdapter1* adapter : fallbackAdapters) {
            if (!opened && tryCreateAndOpen(adapter, D3D_DRIVER_TYPE_UNKNOWN)) {
                opened = true;
            }
            adapter->Release();
        }

        if (!opened) {
            opened = tryCreateAndOpen(nullptr, D3D_DRIVER_TYPE_HARDWARE);
        }

        wglMakeCurrent(nullptr, nullptr);
        return opened && (gl_hDevice != nullptr);
    }

    void cleanupRetiredBuffer(RetiredBuffer& rb) {
        if (rb.nt_handle) {
            CloseHandle(rb.nt_handle);
            rb.nt_handle = nullptr;
        }
        if (rb.dxgi_resource1) {
            rb.dxgi_resource1->Release();
            rb.dxgi_resource1 = nullptr;
        }
        if (rb.d3d_shared_texture) {
            rb.d3d_shared_texture->Release();
            rb.d3d_shared_texture = nullptr;
        }
    }

    void cleanupBuffer(BufferEntry& b, int index = -1, uint64_t generation = 0, bool defer_if_in_use = false) {
        if (b.gl_registered_obj && gl_hDevice && wglDXUnregisterObjectNV) {
            wglDXUnregisterObjectNV(gl_hDevice, b.gl_registered_obj);
            b.gl_registered_obj = nullptr;
        }
        if (b.gl_fbo && glDeleteFramebuffers) {
            glDeleteFramebuffers(1, &b.gl_fbo);
            b.gl_fbo = 0;
        }
        if (b.gl_texture) {
            glDeleteTextures(1, &b.gl_texture);
            b.gl_texture = 0;
        }
        if (b.d3d_render_texture) {
            b.d3d_render_texture->Release();
            b.d3d_render_texture = nullptr;
        }
        if (defer_if_in_use && b.in_use.load(std::memory_order_acquire) &&
            (b.nt_handle || b.d3d_shared_texture || b.dxgi_resource1)) {
            retired_buffers.push_back(RetiredBuffer{
                index,
                generation,
                b.d3d_shared_texture,
                b.dxgi_resource1,
                b.nt_handle
            });
            b.d3d_shared_texture = nullptr;
            b.dxgi_resource1 = nullptr;
            b.nt_handle = nullptr;
        } else {
            if (b.nt_handle) {
                CloseHandle(b.nt_handle);
                b.nt_handle = nullptr;
            }
            if (b.dxgi_resource1) {
                b.dxgi_resource1->Release();
                b.dxgi_resource1 = nullptr;
            }
            if (b.d3d_shared_texture) {
                b.d3d_shared_texture->Release();
                b.d3d_shared_texture = nullptr;
            }
        }
        b.in_use.store(false, std::memory_order_release);
    }

    void cleanupD3D11(bool force_all_retired = false) {
        {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            uint64_t gen = current_generation.load(std::memory_order_acquire);
            for (int i = 0; i < NUM_BUFFERS; i++) {
                cleanupBuffer(buffers[i], i, gen, !force_all_retired);
            }
            if (force_all_retired) {
                for (auto& rb : retired_buffers) {
                    cleanupRetiredBuffer(rb);
                }
                retired_buffers.clear();
            }
        }
        if (gl_hDevice && wglDXCloseDeviceNV) {
            wglDXCloseDeviceNV(gl_hDevice);
            gl_hDevice = nullptr;
        }
        if (d3d_context) {
            d3d_context->Release();
            d3d_context = nullptr;
        }
        if (d3d_device) {
            d3d_device->Release();
            d3d_device = nullptr;
        }
        buffers_allocated = false;
    }

    bool allocateBuffers(int width, int height) {
        int target_w = (width > 0) ? width : 1280;
        int target_h = (height > 0) ? height : 720;

        // Wait for in-flight buffers to be released by Chromium before retiring/reallocating textures
        {
            std::unique_lock<std::mutex> lock(buffer_mutex);
            cv_buffer_freed.wait_for(lock, std::chrono::milliseconds(500), [this]() {
                for (int i = 0; i < NUM_BUFFERS; i++) {
                    if (buffers[i].in_use.load(std::memory_order_acquire)) {
                        return false;
                    }
                }
                return true;
            });
        }

        std::lock_guard<std::mutex> lock(buffer_mutex);

        uint64_t old_gen = current_generation.load(std::memory_order_acquire);
        for (int i = 0; i < NUM_BUFFERS; i++) {
            cleanupBuffer(buffers[i], i, old_gen, true);
        }
        buffers_allocated = false;
        current_generation.fetch_add(1, std::memory_order_acq_rel);

        if (!d3d_device || !gl_hDevice) {
            printf("[dx_bridge] allocateBuffers failed: device or gl_hDevice is null\n");
            current_width = 0;
            current_height = 0;
            return false;
        }

        for (int i = 0; i < NUM_BUFFERS; i++) {
            // 1. Pure D3D11 Render Target for OpenGL / WGL Interop
            D3D11_TEXTURE2D_DESC renderDesc = {};
            renderDesc.Width = target_w;
            renderDesc.Height = target_h;
            renderDesc.MipLevels = 1;
            renderDesc.ArraySize = 1;
            renderDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
            renderDesc.SampleDesc.Count = 1;
            renderDesc.SampleDesc.Quality = 0;
            renderDesc.Usage = D3D11_USAGE_DEFAULT;
            renderDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
            renderDesc.CPUAccessFlags = 0;
            renderDesc.MiscFlags = 0;

            HRESULT hr = d3d_device->CreateTexture2D(&renderDesc, nullptr, &buffers[i].d3d_render_texture);
            if (FAILED(hr)) {
                printf("[dx_bridge] CreateTexture2D render failed: 0x%08X\n", (unsigned int)hr);
                for (int j = 0; j <= i; j++) cleanupBuffer(buffers[j]);
                current_width = 0;
                current_height = 0;
                return false;
            }

            // 2. Shared NT Texture for Electron sharedTexture
            D3D11_TEXTURE2D_DESC sharedDesc = renderDesc;
            sharedDesc.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;

            hr = d3d_device->CreateTexture2D(&sharedDesc, nullptr, &buffers[i].d3d_shared_texture);
            if (FAILED(hr)) {
                printf("[dx_bridge] CreateTexture2D shared failed: 0x%08X\n", (unsigned int)hr);
                for (int j = 0; j <= i; j++) cleanupBuffer(buffers[j]);
                current_width = 0;
                current_height = 0;
                return false;
            }

            hr = buffers[i].d3d_shared_texture->QueryInterface(__uuidof(IDXGIResource1), (void**)&buffers[i].dxgi_resource1);
            if (FAILED(hr)) {
                printf("[dx_bridge] QueryInterface IDXGIResource1 failed: 0x%08X\n", (unsigned int)hr);
                for (int j = 0; j <= i; j++) cleanupBuffer(buffers[j]);
                current_width = 0;
                current_height = 0;
                return false;
            }

            hr = buffers[i].dxgi_resource1->CreateSharedHandle(
                nullptr,
                DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                nullptr,
                &buffers[i].nt_handle
            );
            if (FAILED(hr)) {
                printf("[dx_bridge] CreateSharedHandle failed: 0x%08X\n", (unsigned int)hr);
                for (int j = 0; j <= i; j++) cleanupBuffer(buffers[j]);
                current_width = 0;
                current_height = 0;
                return false;
            }

            // 3. Register render texture with WGL
            glGenTextures(1, &buffers[i].gl_texture);
            glBindTexture(GL_TEXTURE_2D, buffers[i].gl_texture);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glBindTexture(GL_TEXTURE_2D, 0);

            buffers[i].gl_registered_obj = wglDXRegisterObjectNV(
                gl_hDevice,
                buffers[i].d3d_render_texture,
                buffers[i].gl_texture,
                GL_TEXTURE_2D,
                WGL_ACCESS_READ_WRITE_NV
            );
            if (!buffers[i].gl_registered_obj) {
                printf("[dx_bridge] wglDXRegisterObjectNV failed: GetLastError = %lu\n", GetLastError());
                for (int j = 0; j <= i; j++) cleanupBuffer(buffers[j]);
                current_width = 0;
                current_height = 0;
                return false;
            }

            glGenFramebuffers(1, &buffers[i].gl_fbo);
            glBindFramebuffer(GL_FRAMEBUFFER, buffers[i].gl_fbo);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, buffers[i].gl_texture, 0);
            glBindFramebuffer(GL_FRAMEBUFFER, 0);

            buffers[i].in_use.store(false, std::memory_order_release);
        }

        // BUG #4 Fix: Assign current dimensions and mark allocated only upon success
        current_width = target_w;
        current_height = target_h;
        buffers_allocated = true;
        return true;
    }

    bool recoverDevice() {
        HRESULT reason = d3d_device ? d3d_device->GetDeviceRemovedReason() : E_FAIL;
        printf("[dx_bridge] D3D11 Device removed / TDR detected (reason: 0x%08X). Attempting recovery...\n", (unsigned int)reason);

        // Wait for in-flight buffers
        {
            std::unique_lock<std::mutex> lock(buffer_mutex);
            cv_buffer_freed.wait_for(lock, std::chrono::milliseconds(500), [this]() {
                for (int i = 0; i < NUM_BUFFERS; i++) {
                    if (buffers[i].in_use.load(std::memory_order_acquire)) return false;
                }
                return true;
            });
        }

        cleanupD3D11(false);

        wglMakeCurrent(dummy_hdc, dummy_hglrc);
        if (!initD3D11()) {
            printf("[dx_bridge] Device recovery: initD3D11 failed\n");
            return false;
        }

        int target_w = current_width > 0 ? current_width : 1280;
        int target_h = current_height > 0 ? current_height : 720;
        if (!allocateBuffers(target_w, target_h)) {
            printf("[dx_bridge] Device recovery: allocateBuffers(%d, %d) failed\n", target_w, target_h);
            return false;
        }

        printf("[dx_bridge] D3D11 Device successfully recovered (%dx%d).\n", target_w, target_h);
        return true;
    }

    bool initMpvRender(mpv_handle* handle) {
        if (!load_libmpv_symbols()) return false;
        mpv_ctx = handle;

        wglMakeCurrent(dummy_hdc, dummy_hglrc);

        mpv_opengl_init_params gl_init_params = {
            get_gl_proc_address,
            nullptr
        };
        int advanced_control = 1;
        mpv_render_param render_params[] = {
            { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
            { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
            { MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced_control },
            { (mpv_render_param_type)0 }
        };

        int err = fn_mpv_render_context_create(&mpv_gl_ctx, mpv_ctx, render_params);
        if (err < 0) {
            mpv_render_param fallback_params[] = {
                { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
                { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
                { (mpv_render_param_type)0 }
            };
            err = fn_mpv_render_context_create(&mpv_gl_ctx, mpv_ctx, fallback_params);
        }

        if (err < 0 || !mpv_gl_ctx) {
            wglMakeCurrent(nullptr, nullptr);
            return false;
        }

        fn_mpv_render_context_set_update_callback(mpv_gl_ctx, onMpvUpdate, this);
        wglMakeCurrent(nullptr, nullptr);

        return true;
    }

    static void onMpvUpdate(void* ctx) {
        DxBridge* bridge = static_cast<DxBridge*>(ctx);
        if (bridge && bridge->hWakeEvent) {
            SetEvent(bridge->hWakeEvent);
        }
    }

    void startRenderLoop() {
        running.store(true);
        render_thread = std::thread(&DxBridge::renderLoop, this);
    }

    void renderLoop() {
        wglMakeCurrent(dummy_hdc, dummy_hglrc);

        while (running.load(std::memory_order_relaxed)) {
            DWORD waitRes = WaitForSingleObject(hWakeEvent, 16);
            if (!running.load(std::memory_order_relaxed)) break;

            // BUG #3: Check for DXGI device removed / TDR
            if (d3d_device) {
                HRESULT removedReason = d3d_device->GetDeviceRemovedReason();
                if (FAILED(removedReason)) {
                    printf("[dx_bridge] Device removed detected: 0x%08X\n", (unsigned int)removedReason);
                    if (!recoverDevice()) {
                        Sleep(50);
                        continue;
                    }
                }
            }

            // BUG #10: Atomic single 64-bit exchange for width/height
            uint64_t packed_resize = pending_resize.exchange(0, std::memory_order_acq_rel);
            int req_w = (int)(packed_resize >> 32);
            int req_h = (int)(packed_resize & 0xFFFFFFFF);
            if (req_w > 0 && req_h > 0 && (req_w != current_width || req_h != current_height || !buffers_allocated)) {
                // BUG #4: Checked allocateBuffers call
                if (!allocateBuffers(req_w, req_h)) {
                    printf("[dx_bridge] allocateBuffers(%d, %d) failed\n", req_w, req_h);
                }
            }

            if (!buffers_allocated || !mpv_gl_ctx) continue;

            uint64_t update_flags = fn_mpv_render_context_update(mpv_gl_ctx);
            if (update_flags & MPV_RENDER_UPDATE_FRAME) {
                int buf_idx = -1;
                for (int i = 0; i < NUM_BUFFERS; i++) {
                    if (!buffers[i].in_use.load(std::memory_order_acquire)) {
                        buf_idx = i;
                        break;
                    }
                }

                if (buf_idx < 0) {
                    // Wait briefly if all buffers are in flight
                    std::unique_lock<std::mutex> bufLock(buffer_mutex);
                    cv_buffer_freed.wait_for(bufLock, std::chrono::milliseconds(12), [this, &buf_idx]() {
                        for (int i = 0; i < NUM_BUFFERS; i++) {
                            if (!buffers[i].in_use.load(std::memory_order_acquire)) {
                                buf_idx = i;
                                return true;
                            }
                        }
                        return false;
                    });
                }

                if (buf_idx >= 0 && buffers[buf_idx].gl_registered_obj) {
                    auto& buf = buffers[buf_idx];

                    BOOL locked = wglDXLockObjectsNV(gl_hDevice, 1, &buf.gl_registered_obj);
                    if (!locked) {
                        if (d3d_device && FAILED(d3d_device->GetDeviceRemovedReason())) {
                            printf("[dx_bridge] Lock failed due to device removal, recovering...\n");
                            recoverDevice();
                        }
                    } else {
                        mpv_opengl_fbo fbo = {
                            (int)buf.gl_fbo,
                            current_width,
                            current_height,
                            GL_RGBA8
                        };
                        int flip = flip_y;
                        mpv_render_param params[] = {
                            { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
                            { MPV_RENDER_PARAM_FLIP_Y, &flip },
                            { (mpv_render_param_type)0 }
                        };

                        fn_mpv_render_context_render(mpv_gl_ctx, params);
                        wglDXUnlockObjectsNV(gl_hDevice, 1, &buf.gl_registered_obj);

                        if (d3d_context && buf.d3d_shared_texture && buf.d3d_render_texture) {
                            d3d_context->CopyResource(buf.d3d_shared_texture, buf.d3d_render_texture);
                            d3d_context->Flush();
                        }

                        buf.in_use.store(true, std::memory_order_release);

                        if (tsfn) {
                            FramePayload* p = new FramePayload{ buf_idx, current_width, current_height, current_generation.load(std::memory_order_acquire) };
                            napi_status s = napi_call_threadsafe_function(tsfn, p, napi_tsfn_nonblocking);
                            if (s != napi_ok) {
                                buf.in_use.store(false, std::memory_order_release);
                                delete p;
                            }
                        } else {
                            buf.in_use.store(false, std::memory_order_release);
                        }
                    }
                }
            }
        }

        wglMakeCurrent(nullptr, nullptr);
    }

    void releaseBuffer(int index, uint64_t generation = 0, bool check_generation = false) {
        if (index >= 0 && index < NUM_BUFFERS) {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            if (check_generation && generation != current_generation.load(std::memory_order_acquire)) {
                for (auto it = retired_buffers.begin(); it != retired_buffers.end(); ++it) {
                    if (it->index == index && it->generation == generation) {
                        cleanupRetiredBuffer(*it);
                        retired_buffers.erase(it);
                        break;
                    }
                }
                return;
            }
            buffers[index].in_use.store(false, std::memory_order_release);
            cv_buffer_freed.notify_all();
            if (hWakeEvent) {
                SetEvent(hWakeEvent);
            }
        }
    }

    bool resize(int width, int height) {
        if (width <= 0 || height <= 0) return false;
        if (width == current_width && height == current_height && buffers_allocated) return true;

        uint64_t packed = ((uint64_t)(uint32_t)width << 32) | (uint32_t)height;
        pending_resize.store(packed, std::memory_order_release);
        if (hWakeEvent) {
            SetEvent(hWakeEvent);
        }
        return true;
    }

    void destroy() {
        if (mpv_gl_ctx && fn_mpv_render_context_set_update_callback) {
            fn_mpv_render_context_set_update_callback(mpv_gl_ctx, nullptr, nullptr);
        }
        running.store(false, std::memory_order_release);
        if (hWakeEvent) {
            SetEvent(hWakeEvent);
        }
        {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            cv_buffer_freed.notify_all();
        }
        if (render_thread.joinable()) {
            render_thread.join();
        }

        wglMakeCurrent(dummy_hdc, dummy_hglrc);

        if (mpv_gl_ctx && fn_mpv_render_context_free) {
            fn_mpv_render_context_free(mpv_gl_ctx);
            mpv_gl_ctx = nullptr;
        }

        cleanupD3D11(true);

        wglMakeCurrent(nullptr, nullptr);

        if (dummy_hglrc) {
            wglDeleteContext(dummy_hglrc);
            dummy_hglrc = nullptr;
        }
        if (dummy_hdc && dummy_hwnd) {
            ReleaseDC(dummy_hwnd, dummy_hdc);
            dummy_hdc = nullptr;
        }
        if (dummy_hwnd) {
            DestroyWindow(dummy_hwnd);
            dummy_hwnd = nullptr;
        }

        if (tsfn) {
            napi_release_threadsafe_function(tsfn, napi_tsfn_abort);
            tsfn = nullptr;
        }
    }
};

static DxBridge* g_bridge = nullptr;

static void call_js_frame_cb(napi_env env, napi_value js_cb, void* context, void* data) {
    if (!data) return;
    FramePayload* p = static_cast<FramePayload*>(data);
    if (!env || !js_cb) {
        delete p;
        return;
    }

    napi_value args[4];
    napi_create_int32(env, p->buffer_index, &args[0]);
    napi_create_int32(env, p->width, &args[1]);
    napi_create_int32(env, p->height, &args[2]);
    napi_create_int64(env, (int64_t)p->generation, &args[3]);

    napi_value undefined, result;
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js_cb, 4, args, &result);

    delete p;
}

// ── Node-API Exported Functions ──────────────────────────────

static napi_value InitBridge(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    if (argc < 1) {
        napi_throw_error(env, nullptr, "init requires an options object");
        return nullptr;
    }

    napi_value opt = argv[0];
    napi_value prop;

    // mpvHandle
    uint64_t mpvPtr = 0;
    bool lossless = true;
    if (napi_get_named_property(env, opt, "mpvHandle", &prop) == napi_ok) {
        napi_valuetype vt;
        napi_typeof(env, prop, &vt);
        if (vt == napi_bigint) {
            napi_get_value_bigint_uint64(env, prop, &mpvPtr, &lossless);
        } else if (vt == napi_number) {
            double d = 0;
            napi_get_value_double(env, prop, &d);
            mpvPtr = (uint64_t)d;
        }
    }
    if (!mpvPtr) {
        napi_throw_error(env, nullptr, "Valid mpvHandle address required");
        return nullptr;
    }

    // width & height
    int width = 1280;
    int height = 720;
    if (napi_get_named_property(env, opt, "width", &prop) == napi_ok) {
        napi_get_value_int32(env, prop, &width);
    }
    if (napi_get_named_property(env, opt, "height", &prop) == napi_ok) {
        napi_get_value_int32(env, prop, &height);
    }

    // flipY
    int flip_y = 0;
    if (napi_get_named_property(env, opt, "flipY", &prop) == napi_ok) {
        napi_get_value_int32(env, prop, &flip_y);
    }

    // onFrame callback
    napi_value onFrameCb = nullptr;
    if (napi_get_named_property(env, opt, "onFrame", &onFrameCb) != napi_ok) {
        napi_throw_error(env, nullptr, "onFrame callback required");
        return nullptr;
    }

    if (g_bridge) {
        delete g_bridge;
        g_bridge = nullptr;
    }

    g_bridge = new DxBridge();
    g_bridge->flip_y = flip_y;

    napi_value resName;
    napi_create_string_utf8(env, "DxBridgeFrameCallback", NAPI_AUTO_LENGTH, &resName);
    napi_status s = napi_create_threadsafe_function(
        env,
        onFrameCb,
        nullptr,
        resName,
        0,
        1,
        nullptr,
        nullptr,
        nullptr,
        call_js_frame_cb,
        &g_bridge->tsfn
    );
    if (s != napi_ok) {
        delete g_bridge;
        g_bridge = nullptr;
        napi_throw_error(env, nullptr, "Failed to create threadsafe frame callback");
        return nullptr;
    }

    if (!g_bridge->initGL()) {
        delete g_bridge;
        g_bridge = nullptr;
        napi_throw_error(env, nullptr, "Failed to initialize WGL/OpenGL context or WGL_NV_DX_interop not supported");
        return nullptr;
    }

    if (!g_bridge->initD3D11()) {
        delete g_bridge;
        g_bridge = nullptr;
        napi_throw_error(env, nullptr, "Failed to initialize D3D11 device or open device in WGL");
        return nullptr;
    }

    wglMakeCurrent(g_bridge->dummy_hdc, g_bridge->dummy_hglrc);
    bool allocOk = g_bridge->allocateBuffers(width, height);
    wglMakeCurrent(nullptr, nullptr);

    if (!allocOk) {
        delete g_bridge;
        g_bridge = nullptr;
        napi_throw_error(env, nullptr, "Failed to allocate D3D11 shared NT textures and WGL FBOs");
        return nullptr;
    }

    if (!g_bridge->initMpvRender((mpv_handle*)mpvPtr)) {
        delete g_bridge;
        g_bridge = nullptr;
        napi_throw_error(env, nullptr, "Failed to initialize mpv_render_context with OpenGL backend");
        return nullptr;
    }

    g_bridge->startRenderLoop();

    napi_value retVal;
    napi_get_boolean(env, true, &retVal);
    return retVal;
}

static napi_value GetNtHandle(napi_env env, napi_callback_info info) {
    if (!g_bridge) {
        napi_throw_error(env, nullptr, "Bridge not initialized");
        return nullptr;
    }

    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    int index = 0;
    if (argc >= 1) {
        napi_get_value_int32(env, argv[0], &index);
    }
    if (index < 0 || index >= NUM_BUFFERS) {
        napi_throw_error(env, nullptr, "Buffer index out of range");
        return nullptr;
    }

    uint64_t expected_gen = 0;
    bool has_generation = false;
    if (argc >= 2) {
        int64_t gen = 0;
        if (napi_get_value_int64(env, argv[1], &gen) == napi_ok) {
            expected_gen = (uint64_t)gen;
            has_generation = true;
        } else {
            bool lossless = false;
            if (napi_get_value_bigint_int64(env, argv[1], &gen, &lossless) == napi_ok) {
                expected_gen = (uint64_t)gen;
                has_generation = true;
            }
        }
    }

    std::lock_guard<std::mutex> lock(g_bridge->buffer_mutex);
    if (has_generation && expected_gen != g_bridge->current_generation.load(std::memory_order_acquire)) {
        return nullptr;
    }
    HANDLE h = g_bridge->buffers[index].nt_handle;
    if (!h) {
        return nullptr;
    }
    void* data = nullptr;
    napi_value buffer;
    napi_create_buffer(env, sizeof(HANDLE), &data, &buffer);
    memcpy(data, &h, sizeof(HANDLE));

    return buffer;
}

static napi_value ReleaseBuffer(napi_env env, napi_callback_info info) {
    if (!g_bridge) return nullptr;

    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    if (argc >= 1) {
        int index = 0;
        napi_get_value_int32(env, argv[0], &index);
        uint64_t generation = 0;
        bool has_generation = false;
        if (argc >= 2) {
            int64_t gen = 0;
            if (napi_get_value_int64(env, argv[1], &gen) == napi_ok) {
                generation = (uint64_t)gen;
                has_generation = true;
            } else {
                bool lossless = false;
                if (napi_get_value_bigint_int64(env, argv[1], &gen, &lossless) == napi_ok) {
                    generation = (uint64_t)gen;
                    has_generation = true;
                }
            }
        }
        g_bridge->releaseBuffer(index, generation, has_generation);
    }

    napi_value ret;
    napi_get_boolean(env, true, &ret);
    return ret;
}

static napi_value Resize(napi_env env, napi_callback_info info) {
    if (!g_bridge) return nullptr;

    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    if (argc >= 2) {
        int w = 0, h = 0;
        napi_get_value_int32(env, argv[0], &w);
        napi_get_value_int32(env, argv[1], &h);
        bool ok = g_bridge->resize(w, h);
        napi_value ret;
        napi_get_boolean(env, ok, &ret);
        return ret;
    }

    napi_value ret;
    napi_get_boolean(env, false, &ret);
    return ret;
}

static napi_value Destroy(napi_env env, napi_callback_info info) {
    if (g_bridge) {
        delete g_bridge;
        g_bridge = nullptr;
    }
    napi_value ret;
    napi_get_boolean(env, true, &ret);
    return ret;
}

NAPI_MODULE_INIT() {
    napi_property_descriptor desc[] = {
        { "init", nullptr, InitBridge, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "getNtHandle", nullptr, GetNtHandle, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "releaseBuffer", nullptr, ReleaseBuffer, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "resize", nullptr, Resize, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "destroy", nullptr, Destroy, nullptr, nullptr, nullptr, napi_default, nullptr }
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
