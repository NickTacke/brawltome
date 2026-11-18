import { expect, test } from 'bun:test'
import { readPack } from '../src/pack.ts'
import { writePack } from './pack-writer.ts'

// a synthetic line's two animations: values the pack's fixed point holds exactly (1024ths, 16ths, 255ths)
const torso = { name: 'a_Torso', spriteFrame: 3, opacity: 1, matrix: [1, 0, 0, 1, 12.5, -40] }
const arm = { name: 'a_ArmRight', spriteFrame: 0, opacity: 51 / 255, matrix: [0.5, -0.25, 0.25, 0.5, -3.0625, 7] }
const flipped = { name: 'a_Torso', spriteFrame: 4, opacity: 0, matrix: [-1, 0, 0, 1, 0, 0] }

// a frame's draws as the reader keeps them: name, sprite frame, opacity and matrix, as 32-bit floats
const float32 = (values: number[]) => [...new Float32Array(values)]

test('readPack round-trips a pack written by the export', () => {
  const bytes = writePack([
    {
      index: 7,
      frameCount: 12,
      frames: new Map([
        [5, [flipped]],
        [0, [torso, arm]],
      ]),
    },
    { index: 2, frameCount: 1, frames: new Map([[0, [arm]]]) },
  ])

  const pack = readPack(bytes.buffer)

  expect(pack.names).toEqual(['a_Torso', 'a_ArmRight'])
  expect([...pack.animations.keys()]).toEqual([7, 2])
  expect(pack.animations.get(7)?.frameCount).toBe(12)
  expect([...(pack.animations.get(7)?.frames.keys() ?? [])]).toEqual([0, 5])

  expect([...(pack.animations.get(7)?.frames.get(0) ?? [])]).toEqual(
    float32([0, 3, 1, 1, 0, 0, 1, 12.5, -40, 1, 0, 0.2, 0.5, -0.25, 0.25, 0.5, -3.0625, 7]),
  )

  expect([...(pack.animations.get(7)?.frames.get(5) ?? [])]).toEqual(float32([0, 4, 0, -1, 0, 0, 1, 0, 0]))

  expect([...(pack.animations.get(2)?.frames.get(0) ?? [])]).toEqual(
    float32([1, 0, 0.2, 0.5, -0.25, 0.25, 0.5, -3.0625, 7]),
  )
})

test('readPack rejects a file that is not an animation pack', () => {
  expect(() => readPack(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow('not an animation pack')
})
