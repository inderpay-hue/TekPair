var LOGIN_TEXTS = {
  es: { title:'Bienvenido de nuevo', sub:'Inicia sesión en tu tienda', email:'Email', pass:'Contraseña', btn:'Entrar', reset:'¿Olvidaste tu contraseña?', reg:'¿No tienes cuenta?', regLink:'Regístrate gratis', volver:'← Volver a tekpair.tech', entrando:'Entrando...', rellena:'Rellena todos los campos', error_conn:'Error de conexión. Intenta de nuevo.' },
  en: { title:'Welcome back', sub:'Sign in to your shop', email:'Email', pass:'Password', btn:'Sign in', reset:'Forgot your password?', reg:"Don't have an account?", regLink:'Register free', volver:'← Back to tekpair.tech', entrando:'Signing in...', rellena:'Fill in all fields', error_conn:'Connection error. Try again.' },
  fr: { title:'Bon retour', sub:'Connectez-vous à votre boutique', email:'Email', pass:'Mot de passe', btn:'Se connecter', reset:'Mot de passe oublié ?', reg:'Pas de compte ?', regLink:'Inscription gratuite', volver:'← Retour à tekpair.tech', entrando:'Connexion...', rellena:'Remplissez tous les champs', error_conn:'Erreur de connexion. Réessayez.' },
  it: { title:'Bentornato', sub:'Accedi al tuo negozio', email:'Email', pass:'Password', btn:'Accedi', reset:'Hai dimenticato la password?', reg:'Non hai un account?', regLink:'Registrati gratis', volver:'← Torna a tekpair.tech', entrando:'Accesso...', rellena:'Compila tutti i campi', error_conn:'Errore di connessione. Riprova.' },
  de: { title:'Willkommen zurück', sub:'Bei Ihrem Shop anmelden', email:'E-Mail', pass:'Passwort', btn:'Anmelden', reset:'Passwort vergessen?', reg:'Noch kein Konto?', regLink:'Kostenlos registrieren', volver:'← Zurück zu tekpair.tech', entrando:'Anmelden...', rellena:'Alle Felder ausfüllen', error_conn:'Verbindungsfehler. Erneut versuchen.' },
  pt: { title:'Bem-vindo de volta', sub:'Inicie sessão na sua loja', email:'Email', pass:'Palavra-passe', btn:'Entrar', reset:'Esqueceu a palavra-passe?', reg:'Não tem conta?', regLink:'Registe-se grátis', volver:'← Voltar a tekpair.tech', entrando:'A entrar...', rellena:'Preencha todos os campos', error_conn:'Erro de ligação. Tente novamente.' },
};
function setLoginLang(lang) {
  localStorage.setItem('tp_lang', lang);
  var t = LOGIN_TEXTS[lang] || LOGIN_TEXTS.es;
  var el = function(id){ return document.getElementById(id); };
  if (el('loginTitle')) el('loginTitle').textContent = t.title;
  if (el('loginSubtitle')) el('loginSubtitle').textContent = t.sub;
  if (el('loginEmailLabel')) el('loginEmailLabel').textContent = t.email;
  if (el('loginPassLabel')) el('loginPassLabel').textContent = t.pass;
  if (el('btn')) el('btn').textContent = t.btn;
  if (el('lnkReset')) el('lnkReset').textContent = t.reset;
  if (el('loginRegFoot')) el('loginRegFoot').innerHTML = t.reg + ' <a href="/registro.html">' + t.regLink + '</a>';
  if (el('loginLangSel')) el('loginLangSel').value = lang;
  if (el('lnkVolver')) el('lnkVolver').textContent = t.volver || '← Volver a tekpair.tech';
}
document.addEventListener('DOMContentLoaded', function() {
  setLoginLang(localStorage.getItem('tp_lang') || 'es');
});
