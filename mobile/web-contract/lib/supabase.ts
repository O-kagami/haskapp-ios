import { requireNativeModule } from 'expo-modules-core';
import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { resolveBackendConfig } from '../../src/backend-config';
// Same public backend as the verified live Web deployment; explicit overrides
// must provide both values. No privileged credential is accepted or embedded.
const url=process.env.EXPO_PUBLIC_SUPABASE_URL;
const key=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const nativeModule=requireNativeModule("HaskappNative");
const uiTest=!!nativeModule.isUITest();
const readOnlyVerification=!!nativeModule.isReadOnlyVerification?.();
const verificationOffline=readOnlyVerification && !!nativeModule.isReadOnlyOffline?.();
const transportFetch=globalThis.fetch;
const testNamespace=uiTest ? nativeModule.uiTestNamespace?.() : undefined;
const isolatedTestId=typeof testNamespace==='string' && /^[A-Za-z0-9-]{1,64}$/.test(testNamespace) ? `guest-ios-uitest-${testNamespace}` : 'guest-ios-uitest';
export const guestId=uiTest ? isolatedTestId : "guest-ios";
const backend=resolveBackendConfig(url,key,uiTest,process.env.EXPO_PUBLIC_DISABLE_CLOUD==='1');
export const configured=backend.configured;
const secureStorage={getItem:SecureStore.getItemAsync,setItem:SecureStore.setItemAsync,removeItem:SecureStore.deleteItemAsync};
export const supabase=createClient(backend.url, backend.key,{
  auth:{storage:configured ? secureStorage : undefined,persistSession:configured,autoRefreshToken:configured,detectSessionInUrl:false,flowType:'pkce',lock:processLock},
  // UI tests and unconfigured guest sessions must never reach a real backend,
  // even if an API call is accidentally added to a guest flow later.
  ...(!configured ? {global:{fetch:async () => {throw new Error('Cloud access is disabled for this session.');}}} : readOnlyVerification ? {global:{fetch:async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestMethod = typeof input === 'object' && 'method' in input ? input.method : 'GET';
    const method = (init?.method ?? requestMethod).toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) throw new Error('Only read-only requests are allowed during aggregate verification.');
    if (verificationOffline) throw new Error('Offline transport is simulated for read-only aggregate cache verification.');
    return transportFetch(input, init);
  }}} : {})
});
let online=configured;
export function getSupabaseStatus(){return online;}
export function setSupabaseOffline(){online=false;}
export function retryConnection(){online=configured;}
export async function getCurrentUserId(){
 if(!configured)return guestId;
 const {data:{session}}=await supabase.auth.getSession();
 return session?.user.id || guestId;
}
export async function getCurrentUser(){if(!configured)return null;const {data:{session}}=await supabase.auth.getSession();return session?.user || null;}
export async function signOutUser(){if(configured){const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;}online=false;}
