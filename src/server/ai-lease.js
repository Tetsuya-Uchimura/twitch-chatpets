const leases=new WeakMap();
export function acquireAILease(store,limit=1){const n=leases.get(store)||0;if(n>=limit)return null;leases.set(store,n+1);let released=false;return()=>{if(!released){released=true;leases.set(store,Math.max(0,(leases.get(store)||1)-1));}};}
