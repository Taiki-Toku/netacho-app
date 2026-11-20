# 依頼 9-2:前後のニュースを、開いた一覧の中で決める

## 不具合
詳細の「前のニュース/次のニュース」とスワイプの移り先が、どの一覧から開いても「同じ日の全ジャンル」になっている(src/data/queries.ts の neighbors)。セキュリティニュースの一覧から開いたら、そのジャンルの中だけで前後に移りたい。design_spec に前後の範囲の決まりが無かった(仕様の抜け)。

## 決まり(design_spec 4章5の「前後のニュース」の後ろに1行で足す)
前後のニュースは、開いた一覧の並びの中で決める:ジャンルの一覧から開いたらそのジャンルの一覧(itemsInGenre の順)、保存の一覧から開いたら保存の一覧の順、それ以外(トップ・さがす・右の欄など)は今のまま同じ日の全ジャンル。どの一覧から開いたかは URL に持たせる(#/item/<id>?from=genre:<ジャンルの id>、#/item/<id>?from=saved)。「一覧に戻る」は開いた一覧へ戻る。前後が無いときの表示(前は押せない文字、次の代わりに「一覧に戻る」)は今のまま。

## 作り方
- src/app/router.ts:item の Route に省略できる from を足す(型は { kind: 'genre'; id: string } | { kind: 'saved' })。parseHash は query の from を読み、形が違う・知らない値は無視する(from なし)。hrefFor は from があるときだけ ?from= を付ける。screenKey は今のまま(id だけ)
- src/data/queries.ts:neighbors に from を渡せるようにする。from が genre で、記事の genre がその id と同じときは itemsInGenre の並び、saved で記事が保存の一覧にあるときは保存の一覧の並び。どちらでもなければ今の動き
- 保存の一覧の並びは SavedScreen と同じものを使う(並べ方の処理が画面の中にあれば queries.ts に関数として出して、両方から使う)
- src/components/ArticleRow.tsx:省略できる from を受け取り、リンクに付ける。GenreScreen は { kind: 'genre', id }、SavedScreen は { kind: 'saved' } を渡す。ほかの呼び出しは変えない
- src/screens/ItemScreen.tsx:Route の from を受け取り、neighbors に渡す。前後のリンク・スワイプの navigate にも同じ from を付ける。戻り先は from が genre ならそのジャンル(kind は all)、saved なら保存の一覧、無ければ今のまま。App.tsx から route を渡す部分も必要なら直す
- from の値は検索・比較にだけ使い、画面に文字として出さない。見た目(CSS)は変えない

## 試験(足す)
1. router:#/item/a?from=genre:security と #/item/a?from=saved を読める、hrefFor と往復で同じになる、from=foo・from=genre:・from なしは from なしになる
2. neighbors:ジャンルの一覧から開いたとき、別のジャンル・別の日の記事を含まずに、itemsInGenre の順で前後が決まる。記事の genre と from が違うときは今の動き。saved も同じく
3. ItemScreen:そのジャンルに記事が1本だけのとき、「前のニュース」は押せない文字、右は「一覧に戻る」で、そのリンク先がそのジャンルの一覧。前後のリンクに from が付いている
4. 今の試験はすべて通る(既存の試験の期待値は変えない。変える必要があれば止めて報告)
