import type { BrawltomeModule, ModuleRuntime } from '@brawltome/foundation'
import type { AnyContractRouter } from '@orpc/contract'
import type { Router } from '@orpc/server'
import type { apiModules } from '../modules'
import type { OrpcContext } from './context'
import { status } from './status'
import type { createVisitorRefreshProcedures } from './visitor-refresh'
import type { createVisitorViewProcedures } from './visitor-views'

type ModuleWithRoutes = BrawltomeModule & { routes: NonNullable<BrawltomeModule['routes']> }

// read from the list's own type, so a client of the router sees each module's procedures with their real types
type ModuleProcedures<TModules extends readonly BrawltomeModule[]> = {
  [TModule in Extract<TModules[number], ModuleWithRoutes> as TModule['name']]: ReturnType<TModule['routes']>
}

/** The API's own procedure groups beside status, for work that spans modules, like a refresh asked for by a visitor. */
type ApiProcedures = Record<string, Router<AnyContractRouter, OrpcContext>>

/** The groups serve.ts passes in. */
export type ServedApiProcedures = {
  refresh: ReturnType<typeof createVisitorRefreshProcedures>
  views: ReturnType<typeof createVisitorViewProcedures>
}

function hasRoutes(module: BrawltomeModule): module is ModuleWithRoutes {
  return module.routes !== undefined
}

// a module of the same name would silently replace the group
function checkNoNameClash(modules: readonly BrawltomeModule[], apiProcedures: ApiProcedures): void {
  const clash = modules.find((module) => module.name === 'status' || module.name in apiProcedures)

  if (clash) throw new Error(`module ${clash.name} has the name of one of the api's own procedure groups`)
}

/** The API's own procedures, plus the procedures of every listed module under that module's name. */
export function createOrpcRouter<
  TModules extends readonly BrawltomeModule[],
  TApiProcedures extends ApiProcedures = Record<never, never>,
>(modules: TModules, runtime: ModuleRuntime, apiProcedures = {} as TApiProcedures) {
  checkNoNameClash(modules, apiProcedures)

  const moduleEntries = modules.filter(hasRoutes).map((module) => [module.name, module.routes(runtime)])
  const moduleProcedures = Object.fromEntries(moduleEntries) as ModuleProcedures<TModules>

  return { status, ...apiProcedures, ...moduleProcedures }
}

export type OrpcRouter = ReturnType<typeof createOrpcRouter<typeof apiModules, ServedApiProcedures>>
