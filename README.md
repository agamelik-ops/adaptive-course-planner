# adaptive-course-planner
An improved planning app for the students of F&M to select their courses

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Planner

The homepage searches all sections in `app/planner/courses.json`, imported from the Spring 2027 master schedule by `scripts/parse_schedule.py`. Search by CRN, title, subject name, or course code (with or without spaces). Search "language" to explore language subjects. Add and remove sections by CRN; the calendar includes all class and lab meetings and flags overlaps. TBA sections appear in the selected list without calendar blocks.

`app/lib/courses.ts` adapts the shared catalog for the homepage. Credit values are not included in the imported data, so credit totals are unavailable. This is a planning tool, not live registration or seat availability. Homepage plans save automatically to localStorage for Spring 2027 and restore on refresh in the same browser. Only CRNs are stored; deleted catalog entries are ignored. There is no account or cross-device sync. If saving fails, changes remain available for the current session and a warning is shown. The original planner remains at `/planner`, and team workspace routes are linked in the footer.
