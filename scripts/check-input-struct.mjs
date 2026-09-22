/** Verify the PET INPUT struct layout matches Win32 INPUT (40 bytes on x64). */
import koffi from 'koffi'

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'long', dy: 'long', mouseData: 'uint', dwFlags: 'uint', time: 'uint', dwExtraInfo: 'uintptr',
})
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'ushort', wScan: 'ushort', dwFlags: 'uint', time: 'uint', dwExtraInfo: 'uintptr',
})
const INPUT_UNION = koffi.union('PET_INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT })
const INPUT = koffi.struct('PET_INPUT', { type: 'uint', padding: 'uint', u: INPUT_UNION })
console.log('sizeof MOUSEINPUT =', koffi.sizeof(MOUSEINPUT))
console.log('sizeof KEYBDINPUT =', koffi.sizeof(KEYBDINPUT))
console.log('sizeof UNION =', koffi.sizeof(INPUT_UNION))
console.log('sizeof INPUT =', koffi.sizeof(INPUT), '(expect 40)')
// quick mouse move (harmless)
const user32 = koffi.load('user32.dll')
const SetCursorPos = user32.func('bool SetCursorPos(int x, int y)')
console.log('SetCursorPos(100,100):', SetCursorPos(100, 100))
