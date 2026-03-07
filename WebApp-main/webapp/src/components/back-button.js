'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

const BackButton = () => {
    const router = useRouter();
    const pathname = usePathname();
    const t = useTranslations();

    const handleBack = () => {
        // Extract locale from path
        let locale;
        try {
            locale = pathname.split('/')[1];
        } catch {
            locale = 'en';
        }

        const localeStripped = pathname.replace(/\/[a-z]{2}/, '');
        const pathParts = localeStripped.split('/').filter(Boolean);

        // Special case for create_course - go back to home with locale
        if (pathParts.length === 1 && pathParts[0] === 'create_course') {
            router.push(`/${locale}`);
            return;
        }
        
        // Default handling for very short paths
        if (pathParts.length <= 1) {
            router.push(`/${locale}`);
            return;
        }
        
        if (pathParts[0] === 'course') {
            if (pathParts.length === 2) {
                router.push(`/${locale}`);
            } else if (pathParts.length === 3) {
                router.push(`/${locale}/course/${pathParts[1]}`);
            } else if (pathParts.length === 4) {
                router.push(`/${locale}/course/${pathParts[1]}/${pathParts[2]}`);
            } else if (pathParts.length >= 5) {
                if (pathParts[4] === 'edit_session' || pathParts[4] === 'create_session') {
                    router.push(`/${locale}/course/${pathParts[1]}/${pathParts[2]}`);
                } else {
                    router.push(`/${locale}${localeStripped.split('/').slice(0, -1).join('/')}`);
                }
            }
        } else {
            router.push(`/${locale}${localeStripped.split('/').slice(0, -1).join('/')}`);
        }
    };

    return (
        <Button type="button" onClick={handleBack}>
            {t('Back')}
        </Button>
    );
};

export default BackButton;