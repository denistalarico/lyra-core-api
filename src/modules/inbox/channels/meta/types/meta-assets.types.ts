export type FacebookPageInstagramAccountAsset = {
  accountId: string;
  username: string | null;
};

export type FacebookPageAsset = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramAccount: FacebookPageInstagramAccountAsset | null;
};

export type FacebookPageGraphAsset = Omit<
  FacebookPageAsset,
  'instagramAccount'
>;
