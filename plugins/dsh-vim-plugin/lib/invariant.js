//#region src/invariant.ts
const PACKAGE_NAME = "dsh-vim-plugin";
/** Cordis companion plugin name. */
const name = "client-ui-vim-mode-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the vim machine is a pure core over the composer's
* editing face and the indicator is presentation; the interceptor
* registration's disposal is proven by the plugin's HMR-safety spec.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
