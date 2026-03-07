'use client'

import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';

export default function LanguageSwitcher() {
  const pathname = usePathname();
  const currentLocale = useLocale();
  
  // Get the path without the locale prefix
  const pathnameWithoutLocale = pathname.split('/').slice(2).join('/');
  
  // Define available locales and their display names
  const locales = [
    { code: 'en', name: 'English' },
    { code: 'pt', name: 'Português' }
  ];

  return (
    <div className="relative group">
      <button className="flex items-center gap-2 text-white">
        <Globe className="h-5 w-5" />
        <span className="hidden md:inline">{currentLocale === 'en' ? 'English' : 'Português'}</span>
      </button>
      
      <div className="absolute right-0 mt-2 w-40 bg-white shadow-lg rounded-md overflow-hidden z-10 transform opacity-0 scale-95 transition-all duration-200 origin-top-right invisible group-hover:visible group-hover:opacity-100 group-hover:scale-100">
        <div className="py-1">
          {locales.map((locale) => (
            <Link 
              key={locale.code} 
              href={`/${pathnameWithoutLocale}`} 
              locale={locale.code}
              className={`block px-4 py-2 text-sm hover:bg-gray-100 ${
                currentLocale === locale.code ? 'bg-gray-100 font-medium' : ''
              }`}
            >
              {locale.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
