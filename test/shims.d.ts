// vuex 4 does not expose its types through its package exports.
declare module 'vuex' {
  export function createStore(options?: object): any
}
