import { resolve } from 'node:path'
import { generateContractOpenApi, serializeContractOpenApi } from '../src/openapi'

const outputPath = resolve(import.meta.dir, '../openapi/contract-proof.openapi.json')
await Bun.write(outputPath, serializeContractOpenApi(generateContractOpenApi()))
