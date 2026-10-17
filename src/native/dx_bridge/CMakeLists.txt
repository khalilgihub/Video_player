cmake_minimum_required(VERSION 3.15)
project(vidplayer-dxbridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(
    ${CMAKE_JS_INC}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../mpv/include
)

add_library(${PROJECT_NAME} SHARED
    dx_bridge.cpp
    ${CMAKE_JS_SRC}
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)

target_link_libraries(${PROJECT_NAME}
    ${CMAKE_JS_LIB}
    d3d11
    dxgi
    opengl32
)
