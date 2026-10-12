// Yalnizca yeni Supabase projesinin PUBLIC bilgilerini yazin.
// Buraya SURVEY_DATA_KEY, SURVEY_CODE_KEY, sb_secret veya service_role KOYMAYIN.
export const CONFIG = Object.freeze({
  supabaseUrl: "https://YENI_PROJE_REF.supabase.co",
  publishableKey: "sb_publishable_YENI_PROJE_KEY",
});

export const API_URL = `${CONFIG.supabaseUrl}/functions/v1/survey-api`;
