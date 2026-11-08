import type { BrawltomeModule, ModuleRuntime } from '@brawltome/foundation'
import type { apiModules } from '../modules'
import { status } from './status'

type ModuleWithRoutes = BrawltomeModule & { routes: NonNullable<BrawltomeModule['routes']> }

// read from the list's own type, so a client of the router sees each module's procedures with their real types
type ModuleProcedures<TModules extends readonly BrawltomeModule[]> = {
  [TModule in Extract<TModules[number], ModuleWithRoutes> as TModule['name']]: ReturnType<TModule['routes']>
}

function hasRoutes(module: BrawltomeModule): module is ModuleWithRoutes {
  return module.routes !== undefined
}

/** The API's own status procedure, plus the procedures of every listed module under that module's name. */
export function createOrpcRouter<TModules extends readonly BrawltomeModule[]>(
  modules: TModules,
  runtime: ModuleRuntime,
) {
  const moduleEntries = modules.filter(hasRoutes).map((module) => [module.name, module.routes(runtime)])
  const moduleProcedures = Object.fromEntries(moduleEntries) as ModuleProcedures<TModules>

  return { status, ...moduleProcedures }
}

export type OrpcRouter = ReturnType<typeof createOrpcRouter<typeof apiModules>>
