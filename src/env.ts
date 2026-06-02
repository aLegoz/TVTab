// true when running in a browser (not Electron)
export const IS_WEB = typeof (window as any).api === 'undefined'
