#!/usr/bin/env bun
// Stand-in for the docker CLI that deploy.sh drives. It keeps containers and image tags in a JSON state file, records
// every call, and answers just enough of compose, ps, inspect, tag, exec and friends for the deploy flow to run.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

type Container = { id: string; service: string; image: string }
type State = {
  project: string
  services: string[]
  containers: Container[]
  tags: Record<string, string>
  counter: number
  execCalls: number
}

const directory = process.env.DOCKER_STUB_DIR
if (!directory) throw new Error('DOCKER_STUB_DIR is not set')
const statePath = `${directory}/state.json`
const args = process.argv.slice(2)
appendFileSync(`${directory}/calls.log`, `${args.join(' ')}\n`)
const state: State = JSON.parse(readFileSync(statePath, 'utf8'))

function save() {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function tagKey(name: string) {
  return name.includes(':') ? name : `${name}:latest`
}

function resolveImage(reference: string) {
  return state.tags[tagKey(reference)] ?? (Object.values(state.tags).includes(reference) ? reference : undefined)
}

function start(service: string) {
  const image = resolveImage(`${state.project}-${service}`)
  if (!image) throw new Error(`no image for ${service}`)
  state.counter += 1
  state.containers.push({ id: `${service}-${state.counter}`, service, image })
}

function remove(id: string) {
  state.containers = state.containers.filter((container) => container.id !== id)
}

function compose(rest: string[]) {
  // Skip `--parallel 1 -p <project> -f <file>`.
  const command = rest.slice(6)
  const [verb, ...options] = command
  if (verb === 'build') {
    for (const service of state.services) state.tags[`${state.project}-${service}:latest`] = `sha256:new-${service}`
    return 0
  }
  if (verb === 'config') {
    process.stdout.write(`${state.services.join('\n')}\n`)
    return 0
  }
  if (verb === 'ps') {
    const service = options.at(-1)
    for (const container of state.containers.filter((item) => item.service === service))
      process.stdout.write(`${container.id}\n`)
    return 0
  }
  if (verb !== 'up') throw new Error(`unsupported compose ${verb}`)

  const valued = new Set(['--exit-code-from', '--scale', '--wait-timeout'])
  const services = options.filter((option, index) => !option.startsWith('-') && !valued.has(options[index - 1]))
  const scale = options.indexOf('--scale')
  if (scale >= 0) {
    const [service, count] = options[scale + 1].split('=')
    while (state.containers.filter((container) => container.service === service).length < Number(count)) start(service)
    return 0
  }
  for (const service of services) {
    if (service === 'migration' || service === 'postgres') continue
    const image = resolveImage(`${state.project}-${service}`)
    const running = state.containers.filter((container) => container.service === service)
    if (running.length === 0) start(service)
    else if (!options.includes('--no-recreate'))
      for (const container of running)
        if (container.image !== image) {
          remove(container.id)
          start(service)
        }
  }
  return 0
}

function main(): number {
  const [command, ...rest] = args
  if (command === 'compose') return compose(rest)
  if (command === 'ps') {
    const filter = rest.find((option) => option.startsWith('label=com.docker.compose.service='))
    const service = filter?.split('=').at(-1)
    for (const container of state.containers.filter((item) => item.service === service))
      process.stdout.write(`${container.id}\n`)
    return 0
  }
  if (command === 'inspect') {
    const [, format, id] = rest
    const container = state.containers.find((item) => item.id === id)
    if (!container) return 1
    if (format.includes('.Image')) process.stdout.write(`${container.image}\n`)
    else if (format.includes('.Restarting')) process.stdout.write('running false healthy\n')
    else process.stdout.write('running healthy\n')
    return 0
  }
  if (command === 'image') {
    const image = resolveImage(rest.at(-1) ?? '')
    if (!image) return 1
    process.stdout.write(`${image}\n`)
    return 0
  }
  if (command === 'tag') {
    const image = resolveImage(rest[0])
    if (!image) return 1
    state.tags[tagKey(rest[1])] = image
    return 0
  }
  if (command === 'rmi') {
    const key = tagKey(rest[0])
    if (!state.tags[key]) return 1
    delete state.tags[key]
    return 0
  }
  if (command === 'stop') return 0
  if (command === 'rm') {
    remove(rest.at(-1) ?? '')
    return 0
  }
  if (command === 'logs') return 0
  if (command === 'exec') {
    // Smoke probes fail when the container runs an image matching DOCKER_STUB_FAIL_IMAGE, or for the first
    // DOCKER_STUB_FAIL_PROBES probes.
    state.execCalls += 1
    const container = state.containers.find((item) => item.id === rest[0])
    const failImage = process.env.DOCKER_STUB_FAIL_IMAGE
    if (state.execCalls <= Number(process.env.DOCKER_STUB_FAIL_PROBES ?? 0)) {
      process.stderr.write('HTTP 503\n')
      return 1
    }
    if (!container || (failImage && container.image.includes(failImage))) {
      process.stderr.write('HTTP 500\n')
      return 1
    }
    return 0
  }
  throw new Error(`unsupported docker ${command}`)
}

const status = main()
save()
process.exit(status)
