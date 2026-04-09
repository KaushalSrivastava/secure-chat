import React, { useState } from "react";
import { ShieldCheck, Key, Eye, EyeOff, Lock } from "lucide-react";
import { motion } from "motion/react";

interface LoginProps {
  onLogin: (password: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) onLogin(password.trim());
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
         style={{ background: "linear-gradient(160deg, #0d1f35 0%, #0e1621 50%, #0a1628 100%)" }}>

      {/* Background glow blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[20%] w-[60%] h-[50%] rounded-full"
             style={{ background: "radial-gradient(circle, rgba(43,91,219,0.12) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div className="absolute bottom-[-10%] right-[10%] w-[50%] h-[40%] rounded-full"
             style={{ background: "radial-gradient(circle, rgba(43,91,219,0.07) 0%, transparent 70%)", filter: "blur(80px)" }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-5"
          >
            <div className="w-24 h-24 rounded-full flex items-center justify-center"
                 style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #2b5bdb 50%, #3b82f6 100%)", boxShadow: "0 0 60px rgba(43,91,219,0.4)" }}>
              <ShieldCheck className="w-11 h-11 text-white" strokeWidth={1.5} />
            </div>
          </motion.div>
          <h1 className="text-3xl font-semibold tracking-tight text-white mb-2">SecureChat</h1>
          <p className="text-sm text-slate-400 text-center leading-relaxed">
            Enter a shared passphrase to open<br />an encrypted private channel
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Key className="h-4.5 w-4.5 text-slate-500" />
            </div>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Shared passphrase…"
              className="w-full pl-11 pr-12 py-3.5 rounded-xl text-[15px] text-white placeholder-slate-600 outline-none transition-all"
              style={{
                background: "rgba(31,45,61,0.8)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "rgba(59,130,246,0.5)")}
              onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <motion.button
            type="submit"
            disabled={!password.trim()}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3.5 rounded-xl text-[15px] font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: password.trim()
                ? "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)"
                : "rgba(31,45,61,0.8)",
              boxShadow: password.trim() ? "0 4px 20px rgba(43,91,219,0.35)" : "none",
            }}
          >
            Join Channel
          </motion.button>
        </form>

        {/* Footer note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-600"
        >
          <Lock className="w-3 h-3" />
          <span>End-to-end encrypted · No servers · Messages expire in 24h</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
