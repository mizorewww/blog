export const defaultPreviewPort = '3001'

export function readArg(args, name) {
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`))

  if (withEquals) {
    return withEquals.slice(name.length + 1)
  }

  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

export function parsePreviewArgs(rawArgs, env = process.env) {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs

  return {
    args,
    port: readArg(args, '--port') || env.PORT || defaultPreviewPort,
    skipBuild: args.includes('--no-build'),
    updateCaddy: args.includes('--update-caddy'),
  }
}
