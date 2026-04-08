import React, { useState } from "react";
import { Lock, Shield, Key } from "lucide-react";
import { motion } from "motion/react";

interface LoginProps {
  onLogin: (password: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onLogin(password.trim());
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-zinc-800/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-zinc-800/10 blur-[100px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md space-y-10 z-10"
      >
        <div className="text-center space-y-4">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto w-20 h-20 bg-zinc-900/80 backdrop-blur-xl rounded-full flex items-center justify-center border border-zinc-800/50 shadow-2xl"
          >
            <Shield className="w-8 h-8 text-zinc-300" strokeWidth={1.5} />
          </motion.div>
          <div>
            <h1 className="text-4xl font-light tracking-tight mb-3 text-white">
              SecureChat
            </h1>
            <p className="text-zinc-400 text-sm tracking-wide uppercase font-medium">
              End-to-end encrypted 1:1 connection
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 mt-12">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
              <Key className="h-5 w-5 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" />
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter master password"
              className="w-full bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl pl-12 pr-6 py-4 text-lg focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-all placeholder:text-zinc-600"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!password.trim()}
            className="w-full bg-white text-black rounded-2xl px-6 py-4 font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 active:scale-[0.98] transition-all"
          >
            Connect
          </button>
        </form>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="text-center mt-12"
        >
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800/50">
            <Lock className="w-3 h-3 text-zinc-500" />
            <p className="text-xs text-zinc-400 font-medium tracking-wide">
              Messages auto-delete after 24 hours
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
