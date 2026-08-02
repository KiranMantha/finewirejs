/**
 * SYNC guard — declared by using the `default` export. 
 * */ 
// export default (to) => true | { redirect };
// Runs inside the router's reactive effect: reads auth synchronously, stays
// fully reactive (idle/logout redirect with no navigation), never cached.

/**
 * ASYNC — only when you must await per navigation 
 * */ 
// export const guardAsync = async (to) => true | { redirect };
import type { GuardLocation, GuardResult } from '../../framework';

const isLoggedIn = () => {
    return true
}

const hasRole = () => {
    return true;
}

export default (to: GuardLocation): GuardResult => {
  if (!isLoggedIn()) return { redirect: `/login?next=${to.path}` };
  if (to.meta.roles && !to.meta.roles.some(hasRole)) return { redirect: '/403' };
  return true;
};