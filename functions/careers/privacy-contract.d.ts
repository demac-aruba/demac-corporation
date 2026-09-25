export interface PrivacyTranslation { text:string;status:'Draft'|'Approved';sourceVersion:string }
export interface PublicPrivacy {text:string;version:string;locale?:'en'|'es'|null;spanishText?:string}
export function parsePrivacyFields(value:object):{privacyLocale?:'en'|'es'|null;privacyTranslation?:PrivacyTranslation|null};
export function policyIdentity(settings:object):string;
export function publicPrivacy(settings:{privacyText:string;privacyVersion:string;privacyLocale?:'en'|'es'|null;privacyTranslation?:PrivacyTranslation|null}):PublicPrivacy;
export function selectPrivacy(privacy:PublicPrivacy,locale:'en'|'es'):{text:string;version:string;contentLocale:'en'|'es'|null;translationPending:boolean};
