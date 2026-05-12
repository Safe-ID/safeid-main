import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const COLORS = {
  bg: '#050B18',
  bgCard: '#0A1628',
  bgCardHover: '#0E1E38',
  border: '#1A2F50',
  borderLight: '#243D6A',
  primary: '#0066FF',
  primaryGlow: '#0044CC',
  secondary: '#38BDF8',
  accent: '#86EFAC',
  accentDim: '#4ADE80',
  text: '#F0F6FF',
  textMuted: '#8BA3C7',
  textDim: '#4A6B9A',
  error: '#F87171',
};

export default function AuthForm({ onSuccess }) {
  const { login, signup, error: authError, loading } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const validateForm = () => {
    if (!formData.email.includes('@')) {
      setError('Email inválido');
      return false;
    }
    if (formData.password.length < 8) {
      setError('Senha deve ter no mínimo 8 caracteres');
      return false;
    }
    if (isSignup && formData.password !== formData.confirmPassword) {
      setError('Senhas não correspondem');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (isSignup) {
        await signup(formData.email, formData.password);
      } else {
        await login(formData.email, formData.password);
      }
      onSuccess?.();
    } catch (err) {
      // Error is handled by AuthContext
    }
  };

  const displayError = error || authError;

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse 80% 50% at 50% -10%, #0D2545 0%, ${COLORS.bg} 60%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
      color: COLORS.text,
    }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::placeholder { color: #2D4A6E; }
      `}</style>

      <div style={{
        width: '100%',
        maxWidth: 420,
        padding: 24,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
                <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
              </svg>
            </div>
            <span style={{
              fontWeight: 700,
              fontSize: 24,
              letterSpacing: -0.5,
              color: COLORS.text,
            }}>
              Safe<span style={{ color: COLORS.secondary }}>ID</span>
            </span>
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
          }}>
            {isSignup ? 'Criar conta' : 'Fazer login'}
          </h1>
          <p style={{
            color: COLORS.textMuted,
            fontSize: 14,
          }}>
            {isSignup
              ? 'Registre-se para começar a verificar seus dados'
              : 'Entre com suas credenciais'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          padding: 24,
        }}>
          {/* Error message */}
          {displayError && (
            <div style={{
              background: '#1A0A0A',
              border: `1px solid ${COLORS.error}44`,
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 16,
              color: COLORS.error,
              fontSize: 13,
            }}>
              {displayError}
            </div>
          )}

          {/* Email field */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              marginBottom: 8,
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.textMuted,
              letterSpacing: 0.5,
            }}>
              EMAIL
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="seu@email.com"
              disabled={loading}
              style={{
                width: '100%',
                background: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: '12px 14px',
                color: COLORS.text,
                fontSize: 14,
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                outline: 'none',
              }}
              onFocus={(e) => e.target.style.borderColor = COLORS.borderLight}
              onBlur={(e) => e.target.style.borderColor = COLORS.border}
            />
          </div>

          {/* Password field */}
          <div style={{ marginBottom: isSignup ? 16 : 24 }}>
            <label style={{
              display: 'block',
              marginBottom: 8,
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.textMuted,
              letterSpacing: 0.5,
            }}>
              SENHA
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 8 caracteres"
              disabled={loading}
              style={{
                width: '100%',
                background: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: '12px 14px',
                color: COLORS.text,
                fontSize: 14,
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                outline: 'none',
              }}
              onFocus={(e) => e.target.style.borderColor = COLORS.borderLight}
              onBlur={(e) => e.target.style.borderColor = COLORS.border}
            />
          </div>

          {/* Confirm password field (signup only) */}
          {isSignup && (
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block',
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.textMuted,
                letterSpacing: 0.5,
              }}>
                CONFIRMAR SENHA
              </label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repita a senha"
                disabled={loading}
                style={{
                  width: '100%',
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  color: COLORS.text,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  outline: 'none',
                }}
                onFocus={(e) => e.target.style.borderColor = COLORS.borderLight}
                onBlur={(e) => e.target.style.borderColor = COLORS.border}
              />
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading
                ? COLORS.border
                : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryGlow})`,
              border: 'none',
              borderRadius: 10,
              color: '#fff',
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) e.target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              if (!loading) e.target.style.transform = 'translateY(0)';
            }}
          >
            {loading ? (isSignup ? 'Criando conta...' : 'Entrando...') : (isSignup ? 'Criar conta' : 'Entrar')}
          </button>
        </form>

        {/* Toggle form type */}
        <div style={{
          textAlign: 'center',
          marginTop: 20,
        }}>
          <span style={{ color: COLORS.textDim, fontSize: 14 }}>
            {isSignup ? 'Já tem conta?' : 'Não tem conta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignup(!isSignup);
                setFormData({ email: '', password: '', confirmPassword: '' });
                setError('');
              }}
              disabled={loading}
              style={{
                background: 'transparent',
                border: 'none',
                color: COLORS.secondary,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {isSignup ? 'Faça login' : 'Registre-se'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
