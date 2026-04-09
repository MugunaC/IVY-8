$fw = 'C:/Users/DELL XPS 9360/Desktop/IVY/pico-w-firmware-plan/firmware-cpp-rtos'
$env:PICO_SDK_PATH = [Environment]::GetEnvironmentVariable('PICO_SDK_PATH','User')
$env:FREERTOS_KERNEL_PATH = [Environment]::GetEnvironmentVariable('FREERTOS_KERNEL_PATH','User')
$env:PICO_TOOLCHAIN_PATH = [Environment]::GetEnvironmentVariable('PICO_TOOLCHAIN_PATH','User')
$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
Remove-Item -Recurse -Force "$fw/build-pico" -ErrorAction SilentlyContinue
cmake -S $fw -B "$fw/build-pico" -G Ninja -DPICO_COMPILER=pico_arm_cortex_m0plus_gcc -DPICO_BOARD=pico_w
